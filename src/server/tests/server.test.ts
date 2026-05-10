/**
 * End-to-end tests for the Arimaatic API server.
 *
 * The tests use Fastify's `inject` API to send simulated HTTP and
 * WebSocket traffic without ever opening a real socket. Persistence,
 * event-bus, email, and JWT-signer concerns are wired through the
 * in-memory fakes so the suite stays infra-free, runs in milliseconds,
 * and never depends on machine state.
 *
 * Each test starts from a fresh server instance to keep tests order-
 * independent. The price is one Fastify build per test, but since we
 * never bind a port, the overhead is negligible.
 *
 * Coverage map (see individual `describe` blocks for assertions):
 *
 *   - User registration                  POST /api/users
 *   - Login                              POST /api/auth/login-sessions
 *   - Refresh-token exchange             POST /api/auth/login-sessions/current/refresh-tokens
 *   - Logout                             DELETE /api/auth/login-sessions/current
 *   - Email verification                 POST /api/users/me/email/verification
 *                                        POST /api/email-verifications/{token}
 *   - Password reset                     POST /api/passwords/resets
 *                                        POST /api/passwords/resets/{token}
 *   - Account deletion                   DELETE /api/users/me
 *   - Sessions create/list/accept/move   POST /api/sessions, etc.
 *   - WebSocket subscription             WS  /api/ws
 */

import { describe, expect, it } from "bun:test";
import { ArimaaGame } from "../../game";
import {
  type SessionEvent,
  acceptSessionResponseSchema,
  createSessionResponseSchema,
  createUserResponseSchema,
  errorResponseSchema,
  getSessionResponseSchema,
  listUserSessionsResponseSchema,
  loginResponseSchema,
  refreshAccessTokenResponseSchema,
  sessionEventSchema,
  submitMoveResponseSchema,
  protectedUserProfileSchema,
} from "../../shared/schema";
import { createAuthTokenSigner, secretFromString } from "../auth/tokens";
import { RecordingEmailSender } from "../email/sender";
import { InMemoryEventBus } from "../events/memoryBus";
import { buildInMemoryDataStore } from "../persistence/memoryStore";
import { buildServer } from "../server";

/* --------------------------------------------------------------------- */
/* Test bench                                                            */
/* --------------------------------------------------------------------- */

/**
 * Build a fresh server instance backed entirely by in-memory fakes.
 *
 * Returned together with the fakes so individual tests can subscribe
 * to events directly, peek inside the email sender, etc.
 */
function buildTestServer(options?: { now?: () => Date }) {
  const store = buildInMemoryDataStore();
  const events = new InMemoryEventBus();
  const emailSender = new RecordingEmailSender();
  const tokenSigner = createAuthTokenSigner(
    secretFromString("test-secret-please-rotate"),
  );
  const app = buildServer({
    store,
    events,
    emailSender,
    tokenSigner,
    publicBaseUrl: "https://example.test",
    now: options?.now,
  });
  return { app, store, events, emailSender, tokenSigner };
}

/**
 * Pull the `rt` cookie value out of a Set-Cookie response header.
 * Used whenever a test needs to pass the refresh-token cookie back to
 * a subsequent inject call.
 */
function extractRtCookie(response: { headers: Record<string, unknown> }): string {
  const setCookie = response.headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? (setCookie as string[])
    : [typeof setCookie === "string" ? setCookie : ""];
  for (const c of cookies) {
    const match = /^rt=([^;]+)/.exec(c);
    if (match !== null) return match[1];
  }
  throw new Error("rt cookie not found in Set-Cookie header");
}

/**
 * Register a user and return the response body plus the `rt` cookie
 * value. Helper for tests that need a "logged-in" user but do not care
 * about the registration endpoint itself.
 */
async function registerUser(
  app: ReturnType<typeof buildTestServer>["app"],
  overrides: Partial<{
    username: string;
    emailAddress: string;
    password: string;
  }> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/users",
    payload: {
      username: overrides.username ?? "alice",
      emailAddress: overrides.emailAddress ?? "alice@example.test",
      password: overrides.password ?? "correcthorsebatterystaple",
    },
  });
  expect(response.statusCode).toBe(200);
  return {
    ...createUserResponseSchema.parse(response.json()),
    rtCookie: extractRtCookie(response),
  };
}

/**
 * Activate a freshly-registered user end-to-end, then exchange the
 * cookie session for an access token. Returns the access token.
 */
async function fullyActivate(
  ctx: ReturnType<typeof buildTestServer>,
  bundle: {
    user: { id: string; emailAddress: string };
    rtCookie: string;
  },
) {
  await ctx.store.users.setActivated(bundle.user.id, true);
  const refreshed = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login-sessions/current/refresh-tokens",
    cookies: { rt: bundle.rtCookie },
  });
  expect(refreshed.statusCode).toBe(200);
  const parsed = refreshAccessTokenResponseSchema.parse(refreshed.json());
  if (!parsed.ok) {
    throw new Error(`expected access-token issue, got reason=${parsed.reason}`);
  }
  return parsed.accessToken;
}

/* --------------------------------------------------------------------- */
/* Registration                                                          */
/* --------------------------------------------------------------------- */

describe("POST /api/users", () => {
  it("creates an unactivated user and issues a refresh token (no access token yet)", async () => {
    const { app } = buildTestServer();
    const bundle = await registerUser(app);
    expect(bundle.user.isActivated).toBe(false);
    expect(bundle.user.isDisabled).toBe(false);
    expect(bundle.rtCookie.length).toBeGreaterThan(40);
    expect(bundle.accessToken).toBeNull();
    await app.close();
  });

  it("rejects a duplicate username with code=username-taken", async () => {
    const { app } = buildTestServer();
    await registerUser(app, { username: "bob", emailAddress: "bob@a.test" });
    const dup = await app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: "bob",
        emailAddress: "bob2@a.test",
        password: "another-secret",
      },
    });
    expect(dup.statusCode).toBe(409);
    const body = errorResponseSchema.parse(dup.json());
    expect(body.code).toBe("username-taken");
    await app.close();
  });

  it("rejects a duplicate email with code=email-taken", async () => {
    const { app } = buildTestServer();
    await registerUser(app, {
      username: "carol",
      emailAddress: "shared@a.test",
    });
    const dup = await app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: "different",
        emailAddress: "shared@a.test",
        password: "another-secret",
      },
    });
    expect(dup.statusCode).toBe(409);
    const body = errorResponseSchema.parse(dup.json());
    expect(body.code).toBe("email-taken");
    await app.close();
  });

  it("rejects a missing username with 400", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        emailAddress: "fallback@a.test",
        password: "correcthorsebatterystaple",
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("rejects a weak password with 400", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: "weak",
        emailAddress: "weak@a.test",
        password: "short", // < 8 chars
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

/* --------------------------------------------------------------------- */
/* Login                                                                 */
/* --------------------------------------------------------------------- */

describe("POST /api/auth/login-sessions", () => {
  it("returns a refresh token and (on activated accounts) an access token", async () => {
    const ctx = buildTestServer();
    const reg = await registerUser(ctx.app, {
      username: "logger",
      emailAddress: "logger@a.test",
      password: "supersecure-password",
    });
    await ctx.store.users.setActivated(reg.user.id, true);
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login-sessions",
      payload: { usernameOrEmail: "logger", password: "supersecure-password" },
    });
    expect(response.statusCode).toBe(200);
    const body = loginResponseSchema.parse(response.json());
    expect(body.accessToken).not.toBeNull();
    await ctx.app.close();
  });

  it("matches by email address as well as username", async () => {
    const { app } = buildTestServer();
    await registerUser(app, {
      username: "byemail",
      emailAddress: "byemail@a.test",
      password: "supersecure-password",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login-sessions",
      payload: {
        usernameOrEmail: "byemail@a.test",
        password: "supersecure-password",
      },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("returns 401 with code=invalid-credentials on a wrong password", async () => {
    const { app } = buildTestServer();
    await registerUser(app, { username: "wrong", emailAddress: "w@a.test" });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login-sessions",
      payload: { usernameOrEmail: "wrong", password: "not-the-password" },
    });
    expect(response.statusCode).toBe(401);
    const body = errorResponseSchema.parse(response.json());
    expect(body.code).toBe("invalid-credentials");
    await app.close();
  });

  it("returns 401 with code=invalid-credentials for an unknown user (no enumeration)", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login-sessions",
      payload: { usernameOrEmail: "ghost", password: "anything-here" },
    });
    expect(response.statusCode).toBe(401);
    const body = errorResponseSchema.parse(response.json());
    expect(body.code).toBe("invalid-credentials");
    await app.close();
  });
});

/* --------------------------------------------------------------------- */
/* Refresh-token exchange                                                */
/* --------------------------------------------------------------------- */

describe("POST /api/auth/login-sessions/current/refresh-tokens", () => {
  it("returns ok=false reason=account-not-activated for an unverified user", async () => {
    const { app } = buildTestServer();
    const reg = await registerUser(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login-sessions/current/refresh-tokens",
      cookies: { rt: reg.rtCookie },
    });
    const body = refreshAccessTokenResponseSchema.parse(response.json());
    expect(body.ok).toBe(false);
    if (!body.ok) {
      expect(body.reason).toBe("account-not-activated");
    }
    await app.close();
  });

  it("returns ok=false reason=account-disabled for a disabled user", async () => {
    const ctx = buildTestServer();
    const reg = await registerUser(ctx.app);
    await ctx.store.users.setActivated(reg.user.id, true);
    // Disable directly through the store; there is no public endpoint
    // for an admin to do this in the current product scope.
    await ctx.store.users.setDisabled(reg.user.id, true);
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login-sessions/current/refresh-tokens",
      cookies: { rt: reg.rtCookie },
    });
    const body = refreshAccessTokenResponseSchema.parse(response.json());
    expect(body.ok).toBe(false);
    if (!body.ok) {
      expect(body.reason).toBe("account-disabled");
    }
    await ctx.app.close();
  });

  it("returns ok=false reason=invalid for a revoked refresh token", async () => {
    const ctx = buildTestServer();
    const reg = await registerUser(ctx.app);
    await ctx.store.users.setActivated(reg.user.id, true);
    // Logout to revoke.
    await ctx.app.inject({
      method: "DELETE",
      url: "/api/auth/login-sessions/current",
      cookies: { rt: reg.rtCookie },
    });
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login-sessions/current/refresh-tokens",
      cookies: { rt: reg.rtCookie },
    });
    const body = refreshAccessTokenResponseSchema.parse(response.json());
    expect(body.ok).toBe(false);
    if (!body.ok) {
      expect(body.reason).toBe("invalid");
    }
    await ctx.app.close();
  });

  it("issues an access token for an activated, enabled user", async () => {
    const ctx = buildTestServer();
    const reg = await registerUser(ctx.app);
    await ctx.store.users.setActivated(reg.user.id, true);
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login-sessions/current/refresh-tokens",
      cookies: { rt: reg.rtCookie },
    });
    const body = refreshAccessTokenResponseSchema.parse(response.json());
    expect(body.ok).toBe(true);
    if (body.ok) {
      expect(body.accessToken.length).toBeGreaterThan(20);
    }
    await ctx.app.close();
  });
});

/* --------------------------------------------------------------------- */
/* Email verification                                                    */
/* --------------------------------------------------------------------- */

describe("email verification flow", () => {
  it("round-trips via the public endpoints (resend → confirm)", async () => {
    const ctx = buildTestServer();
    const reg = await registerUser(ctx.app, {
      username: "vu",
      emailAddress: "verify@a.test",
    });
    // The resend endpoint is authenticated via the rt cookie
    // (the registering user has a cookie but no access token, since
    // they are not yet activated).
    const resend = await ctx.app.inject({
      method: "POST",
      url: "/api/users/me/email/verification",
      cookies: { rt: reg.rtCookie },
    });
    expect(resend.statusCode).toBe(200);
    const email = ctx.emailSender.lastTo("verify@a.test");
    if (email === undefined) throw new Error("verification email not sent");
    // The text body contains the verification URL; pull the token out.
    const match = /token=([^\s)]+)/.exec(email.text);
    if (match === null) throw new Error("verification token missing in body");
    const token = decodeURIComponent(match[1]);

    const confirm = await ctx.app.inject({
      method: "POST",
      url: `/api/email-verifications/${encodeURIComponent(token)}`,
    });
    expect(confirm.statusCode).toBe(200);

    const after = await ctx.store.users.getById(reg.user.id);
    expect(after?.isActivated).toBe(true);
    await ctx.app.close();
  });

  it("rejects an unknown verification token with 404", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/email-verifications/not-a-real-token",
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

/* --------------------------------------------------------------------- */
/* Password reset                                                        */
/* --------------------------------------------------------------------- */

describe("password reset flow", () => {
  it("emails a reset link and lets the user choose a new password", async () => {
    const ctx = buildTestServer();
    const reg = await registerUser(ctx.app, {
      username: "resetter",
      emailAddress: "reset@a.test",
      password: "old-strong-password",
    });
    await ctx.store.users.setActivated(reg.user.id, true);

    const requested = await ctx.app.inject({
      method: "POST",
      url: "/api/passwords/resets",
      payload: { emailAddress: "reset@a.test" },
    });
    expect(requested.statusCode).toBe(200);

    const email = ctx.emailSender.lastTo("reset@a.test");
    if (email === undefined) throw new Error("reset email not sent");
    const match = /token=([^\s)]+)/.exec(email.text);
    if (match === null) throw new Error("reset token missing in body");
    const token = decodeURIComponent(match[1]);

    const completed = await ctx.app.inject({
      method: "POST",
      url: `/api/passwords/resets/${encodeURIComponent(token)}`,
      payload: { newPassword: "the-new-strong-password" },
    });
    expect(completed.statusCode).toBe(200);

    // Login with the new password should succeed.
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login-sessions",
      payload: {
        usernameOrEmail: "resetter",
        password: "the-new-strong-password",
      },
    });
    expect(login.statusCode).toBe(200);
    await ctx.app.close();
  });

  it("returns 200 (silent) when the email does not match a user", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/passwords/resets",
      payload: { emailAddress: "ghost@a.test" },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("revokes outstanding refresh tokens after a successful reset", async () => {
    const ctx = buildTestServer();
    const reg = await registerUser(ctx.app, {
      username: "revoked",
      emailAddress: "revoked@a.test",
      password: "old-strong-password",
    });
    await ctx.store.users.setActivated(reg.user.id, true);
    // Trigger reset.
    await ctx.app.inject({
      method: "POST",
      url: "/api/passwords/resets",
      payload: { emailAddress: "revoked@a.test" },
    });
    const email = ctx.emailSender.lastTo("revoked@a.test");
    if (email === undefined) throw new Error("reset email not sent");
    const token = decodeURIComponent(
      (/token=([^\s)]+)/.exec(email.text) ?? [])[1] ?? "",
    );
    await ctx.app.inject({
      method: "POST",
      url: `/api/passwords/resets/${encodeURIComponent(token)}`,
      payload: { newPassword: "completely-new-password" },
    });
    // The original rt cookie should no longer redeem (token was revoked).
    const exchange = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login-sessions/current/refresh-tokens",
      cookies: { rt: reg.rtCookie },
    });
    const body = refreshAccessTokenResponseSchema.parse(exchange.json());
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.reason).toBe("invalid");
    await ctx.app.close();
  });
});

/* --------------------------------------------------------------------- */
/* Account deletion                                                      */
/* --------------------------------------------------------------------- */

describe("DELETE /api/users/me", () => {
  it("removes the user and nulls their session FKs", async () => {
    const ctx = buildTestServer();
    const reg = await registerUser(ctx.app);
    const accessToken = await fullyActivate(ctx, reg);

    // Create a session so we can verify ownership is nulled.
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions?side=gold",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const created200 = createSessionResponseSchema.parse(created.json());

    const del = await ctx.app.inject({
      method: "DELETE",
      url: "/api/users/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(del.statusCode).toBe(200);

    // The user is gone…
    expect(await ctx.store.users.getById(reg.user.id)).toBeNull();
    // …and the session row's gold side is now null.
    const stored = await ctx.store.sessions.getById(created200.sessionId);
    expect(stored?.goldUserId).toBeNull();
    await ctx.app.close();
  });
});

/* --------------------------------------------------------------------- */
/* Sessions: create / list / accept / move                               */
/* --------------------------------------------------------------------- */

describe("POST /api/sessions", () => {
  it("requires authentication", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/sessions?side=gold",
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("creates a session owned by the authenticated user", async () => {
    const ctx = buildTestServer();
    const reg = await registerUser(ctx.app);
    const accessToken = await fullyActivate(ctx, reg);
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions?side=gold",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = createSessionResponseSchema.parse(response.json());
    expect(body.snapshot.participants.gold?.userId).toBe(reg.user.id);
    expect(body.acceptToken).toMatch(/^\d{8}$/);
    await ctx.app.close();
  });
});

describe("POST /api/session-accept", () => {
  it("makes the joining user the opposite side", async () => {
    const ctx = buildTestServer();
    const alice = await registerUser(ctx.app, {
      username: "alice2",
      emailAddress: "a2@a.test",
    });
    const bob = await registerUser(ctx.app, {
      username: "bob2",
      emailAddress: "b2@a.test",
    });
    const aliceAccess = await fullyActivate(ctx, alice);
    const bobAccess = await fullyActivate(ctx, bob);

    const created = createSessionResponseSchema.parse(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/sessions?side=gold",
          headers: { authorization: `Bearer ${aliceAccess}` },
        })
      ).json(),
    );

    const accepted = await ctx.app.inject({
      method: "POST",
      url: "/api/session-accept",
      headers: { authorization: `Bearer ${bobAccess}` },
      payload: { acceptToken: created.acceptToken },
    });
    expect(accepted.statusCode).toBe(200);
    const body = acceptSessionResponseSchema.parse(accepted.json());
    expect(body.side).toBe("silver");
    expect(body.snapshot.participants.silver?.userId).toBe(bob.user.id);
    await ctx.app.close();
  });

  it("treats a re-used accept token as 404", async () => {
    const ctx = buildTestServer();
    const alice = await registerUser(ctx.app, {
      username: "alice3",
      emailAddress: "a3@a.test",
    });
    const bob = await registerUser(ctx.app, {
      username: "bob3",
      emailAddress: "b3@a.test",
    });
    const aliceAccess = await fullyActivate(ctx, alice);
    const bobAccess = await fullyActivate(ctx, bob);
    const created = createSessionResponseSchema.parse(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/sessions?side=gold",
          headers: { authorization: `Bearer ${aliceAccess}` },
        })
      ).json(),
    );
    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/session-accept",
      headers: { authorization: `Bearer ${bobAccess}` },
      payload: { acceptToken: created.acceptToken },
    });
    expect(first.statusCode).toBe(200);
    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/session-accept",
      headers: { authorization: `Bearer ${bobAccess}` },
      payload: { acceptToken: created.acceptToken },
    });
    expect(second.statusCode).toBe(404);
    await ctx.app.close();
  });
});

describe("POST /api/sessions/:id/moves", () => {
  /**
   * Helper: fully provision a two-player game and return both
   * participants' access tokens.
   */
  async function provisionTwoPlayerGame() {
    const ctx = buildTestServer();
    const alice = await registerUser(ctx.app, {
      username: "alice4",
      emailAddress: "a4@a.test",
    });
    const bob = await registerUser(ctx.app, {
      username: "bob4",
      emailAddress: "b4@a.test",
    });
    const aliceToken = await fullyActivate(ctx, alice);
    const bobToken = await fullyActivate(ctx, bob);
    const created = createSessionResponseSchema.parse(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/sessions?side=gold",
          headers: { authorization: `Bearer ${aliceToken}` },
        })
      ).json(),
    );
    await ctx.app.inject({
      method: "POST",
      url: "/api/session-accept",
      headers: { authorization: `Bearer ${bobToken}` },
      payload: { acceptToken: created.acceptToken },
    });
    return {
      ctx,
      sessionId: created.sessionId,
      aliceToken, // gold
      bobToken, // silver
    };
  }

  it("accepts a legal move from the side whose turn it is", async () => {
    const { ctx, sessionId, aliceToken } = await provisionTwoPlayerGame();
    const move = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/moves`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { moveNotation: "Ca2n" },
    });
    expect(move.statusCode).toBe(200);
    const body = submitMoveResponseSchema.parse(move.json());
    expect(body.snapshot.status).toBe("silver");
    await ctx.app.close();
  });

  it("rejects a move from the wrong side with 409", async () => {
    const { ctx, sessionId, bobToken } = await provisionTwoPlayerGame();
    const response = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/moves`,
      headers: { authorization: `Bearer ${bobToken}` },
      payload: { moveNotation: "ra7s" },
    });
    expect(response.statusCode).toBe(409);
    await ctx.app.close();
  });

  it("rejects a move from a third-party user with 403", async () => {
    const { ctx, sessionId } = await provisionTwoPlayerGame();
    const eve = await registerUser(ctx.app, {
      username: "eve",
      emailAddress: "eve@a.test",
    });
    const eveToken = await fullyActivate(ctx, eve);
    const response = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/moves`,
      headers: { authorization: `Bearer ${eveToken}` },
      payload: { moveNotation: "Ca2n" },
    });
    expect(response.statusCode).toBe(403);
    await ctx.app.close();
  });
});

/* --------------------------------------------------------------------- */
/* GET /api/users/me/sessions                                            */
/* --------------------------------------------------------------------- */

describe("GET /api/users/me/sessions", () => {
  it("returns only the authenticated user's games", async () => {
    const ctx = buildTestServer();
    const alice = await registerUser(ctx.app, {
      username: "alice5",
      emailAddress: "a5@a.test",
    });
    const bob = await registerUser(ctx.app, {
      username: "bob5",
      emailAddress: "b5@a.test",
    });
    const aliceToken = await fullyActivate(ctx, alice);
    const bobToken = await fullyActivate(ctx, bob);

    // Alice creates two sessions, Bob creates one.
    await ctx.app.inject({
      method: "POST",
      url: "/api/sessions?side=gold",
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    await ctx.app.inject({
      method: "POST",
      url: "/api/sessions?side=silver",
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    await ctx.app.inject({
      method: "POST",
      url: "/api/sessions?side=gold",
      headers: { authorization: `Bearer ${bobToken}` },
    });

    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/users/me/sessions?limit=10",
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = listUserSessionsResponseSchema.parse(response.json());
    expect(body.sessions).toHaveLength(2);
    for (const entry of body.sessions) {
      expect(["gold", "silver"]).toContain(entry.yourSide);
      // Waiting for opponent → whoseTurn is null.
      expect(entry.whoseTurn).toBeNull();
    }
    await ctx.app.close();
  });

  it("paginates with a cursor", async () => {
    const ctx = buildTestServer();
    const alice = await registerUser(ctx.app, {
      username: "page",
      emailAddress: "page@a.test",
    });
    const aliceToken = await fullyActivate(ctx, alice);
    // Create 3 sessions
    for (let i = 0; i < 3; i++) {
      await ctx.app.inject({
        method: "POST",
        url: "/api/sessions?side=gold",
        headers: { authorization: `Bearer ${aliceToken}` },
      });
    }
    const first = await ctx.app.inject({
      method: "GET",
      url: "/api/users/me/sessions?limit=2",
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    const firstBody = listUserSessionsResponseSchema.parse(first.json());
    expect(firstBody.sessions).toHaveLength(2);
    expect(firstBody.nextCursor).not.toBeNull();
    const second = await ctx.app.inject({
      method: "GET",
      url: `/api/users/me/sessions?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    const secondBody = listUserSessionsResponseSchema.parse(second.json());
    expect(secondBody.sessions).toHaveLength(1);
    expect(secondBody.nextCursor).toBeNull();
    await ctx.app.close();
  });
});

/* --------------------------------------------------------------------- */
/* GET /api/users/me                                                     */
/* --------------------------------------------------------------------- */

describe("GET /api/users/me", () => {
  it("returns the authenticated user's profile", async () => {
    const ctx = buildTestServer();
    const reg = await registerUser(ctx.app, {
      username: "me",
      emailAddress: "me@a.test",
    });
    const accessToken = await fullyActivate(ctx, reg);
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/users/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = protectedUserProfileSchema.parse(response.json());
    expect(body.username).toBe("me");
    await ctx.app.close();
  });

  it("returns 401 with no bearer token", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({ method: "GET", url: "/api/users/me" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

/* --------------------------------------------------------------------- */
/* GET /api/sessions/:id (anonymous spectating)                          */
/* --------------------------------------------------------------------- */

describe("GET /api/sessions/:id (anonymous)", () => {
  it("is accessible without authentication", async () => {
    const ctx = buildTestServer();
    const reg = await registerUser(ctx.app);
    const accessToken = await fullyActivate(ctx, reg);
    const created = createSessionResponseSchema.parse(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/sessions?side=gold",
          headers: { authorization: `Bearer ${accessToken}` },
        })
      ).json(),
    );
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${created.sessionId}`,
    });
    expect(response.statusCode).toBe(200);
    const snapshot = getSessionResponseSchema.parse(response.json());
    // The transcript should round-trip through the engine.
    const game = ArimaaGame.fromTranscript(snapshot.transcript);
    expect(game.getMoveLog()).toHaveLength(0);
    await ctx.app.close();
  });
});

/* --------------------------------------------------------------------- */
/* WS /api/ws                                                            */
/* --------------------------------------------------------------------- */

describe("WS /api/ws", () => {
  it("forwards move events to subscribed clients", async () => {
    const ctx = buildTestServer();
    const alice = await registerUser(ctx.app, {
      username: "wsalice",
      emailAddress: "wsa@a.test",
    });
    const bob = await registerUser(ctx.app, {
      username: "wsbob",
      emailAddress: "wsb@a.test",
    });
    const aliceToken = await fullyActivate(ctx, alice);
    const bobToken = await fullyActivate(ctx, bob);

    const address = await ctx.app.listen({ host: "127.0.0.1", port: 0 });
    const created = createSessionResponseSchema.parse(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/sessions?side=gold",
          headers: { authorization: `Bearer ${aliceToken}` },
        })
      ).json(),
    );
    await ctx.app.inject({
      method: "POST",
      url: "/api/session-accept",
      headers: { authorization: `Bearer ${bobToken}` },
      payload: { acceptToken: created.acceptToken },
    });

    const wsUrl = address.replace("http://", "ws://");
    const ws = new WebSocket(`${wsUrl}/api/ws?sessionId=${created.sessionId}`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", (e) => reject(e));
    });
    // Yield once so the server-side subscription has time to register.
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    const frames: SessionEvent[] = [];
    const gotFrame = new Promise<void>((resolve, reject) => {
      ws.addEventListener("message", (event) => {
        try {
          const parsed = sessionEventSchema.parse(
            JSON.parse(event.data as string),
          );
          frames.push(parsed);
          resolve();
        } catch (e) {
          reject(e as Error);
        }
      });
    });

    await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${created.sessionId}/moves`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { moveNotation: "Ca2n" },
    });

    await gotFrame;
    expect(frames.some((f) => f.type === "move")).toBe(true);

    const closed = new Promise<void>((resolve) =>
      ws.addEventListener("close", () => resolve()),
    );
    ws.close();
    await closed;
    (
      ctx.app.server as { closeAllConnections?: () => void }
    ).closeAllConnections?.();
    await ctx.app.close();
  });
});
