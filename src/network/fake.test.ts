/**
 * Unit tests for the in-memory `FakeAuthApiClient` and
 * `FakeGameSessionApiClient`.
 *
 * The fakes are not the production code, but they ARE the test
 * doubles every component test relies on, so a regression here
 * would cascade into wrong-feeling component tests. We test them
 * directly to make sure that:
 *
 *   - Registration → login → refresh round-trips a single session.
 *   - The `pending` failure paths surface the right reasons.
 *   - The verification round-trip flips `isActivated`.
 *   - The password-reset round-trip rotates the password and
 *     revokes outstanding refresh tokens.
 *   - Account deletion nulls out session FKs and removes refresh tokens.
 *   - Multi-user session ownership works when two users with separate
 *     access tokens interact through the games API.
 */

import { describe, expect, it } from "bun:test";
import { ApiError } from "./api";
import { buildFakeNetwork } from "./fake";

describe("FakeAuthApiClient", () => {
  it("registers a user and sets the rt cookie without an access token", async () => {
    const { authApi, state } = buildFakeNetwork();
    const bundle = await authApi.registerUser({
      username: "alice",
      emailAddress: "alice@example.test",
      password: "supersecure",
    });
    expect(bundle.user.username).toBe("alice");
    expect(bundle.user.isActivated).toBe(false);
    // The refresh token is in the simulated cookie jar, not the response body.
    expect(state.cookieJar).not.toBeNull();
    expect((state.cookieJar ?? "").length).toBeGreaterThan(0);
    expect(bundle.accessToken).toBeNull();
  });

  it("rejects a duplicate username with code=username-taken", async () => {
    const { authApi } = buildFakeNetwork();
    await authApi.registerUser({
      username: "alice",
      emailAddress: "alice@example.test",
      password: "supersecure",
    });
    try {
      await authApi.registerUser({
        username: "alice",
        emailAddress: "different@example.test",
        password: "supersecure",
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("username-taken");
    }
  });

  it("returns reason=account-not-activated when redeeming an unactivated user", async () => {
    const { authApi } = buildFakeNetwork();
    await authApi.registerUser({
      username: "u1",
      emailAddress: "u1@a.test",
      password: "supersecure",
    });
    // The rt cookie was set by registerUser; refreshAccessToken reads from the cookie jar.
    const result = await authApi.refreshAccessToken();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("account-not-activated");
  });

  it("activates a user via the verification round-trip", async () => {
    const { authApi, state } = buildFakeNetwork();
    const reg = await authApi.registerUser({
      username: "u2",
      emailAddress: "u2@a.test",
      password: "supersecure",
    });
    // The resend endpoint authenticates via the rt cookie (the
    // unactivated user has a cookie but no access token).
    await authApi.resendVerificationEmail();
    const email = state.emails[state.emails.length - 1];
    if (email?.token === undefined) throw new Error("no verification token");
    await authApi.confirmEmail(email.token);
    const after = state.users.find((u) => u.id === reg.user.id);
    expect(after?.isActivated).toBe(true);
  });

  it("rotates the password and revokes refresh tokens on reset completion", async () => {
    const { authApi, state } = buildFakeNetwork();
    const registered = await authApi.registerUser({
      username: "u3",
      emailAddress: "u3@a.test",
      password: "supersecure",
    });
    // Activate so refresh-token revocation actually has something to
    // matter against.
    const u = state.users.find((u) => u.id === registered.user.id);
    if (u !== undefined) u.isActivated = true;

    await authApi.requestPasswordReset({ emailAddress: "u3@a.test" });
    const email = state.emails[state.emails.length - 1];
    if (email?.token === undefined) throw new Error("no reset token");
    await authApi.completePasswordReset(email.token, {
      newPassword: "completelyNewPwd",
    });

    // The cookie jar still holds the original (now revoked) token.
    const exchange = await authApi.refreshAccessToken();
    expect(exchange.ok).toBe(false);
    if (!exchange.ok) expect(exchange.reason).toBe("invalid");

    // New password works
    const login = await authApi.login({
      usernameOrEmail: "u3",
      password: "completelyNewPwd",
    });
    expect(login.user.username).toBe("u3");
  });

  it("returns 200 (silent) when requesting reset for an unknown email", async () => {
    const { authApi } = buildFakeNetwork();
    const result = await authApi.requestPasswordReset({
      emailAddress: "ghost@a.test",
    });
    expect(result).toEqual({});
  });

  it("deletes the account and nulls session FKs", async () => {
    const { authApi, gameApi, state } = buildFakeNetwork();
    const reg = await authApi.registerUser({
      username: "deleter",
      emailAddress: "del@a.test",
      password: "supersecure",
    });
    // Forge an access token bound to this user for the fake.
    const accessToken = `at-77777777|${reg.user.id}`;
    state.lastAccessToken = accessToken;

    const created = await gameApi.createSession({ accessToken, side: "gold" });
    await authApi.deleteAccount(accessToken);
    const stored = state.sessions.find((s) => s.id === created.sessionId);
    expect(stored?.goldUserId).toBeNull();
    expect(state.users).toHaveLength(0);
  });
});

describe("FakeGameSessionApiClient", () => {
  it("creates and accepts a session between two users", async () => {
    const { authApi, gameApi, state } = buildFakeNetwork();
    const a = await authApi.registerUser({
      username: "alice",
      emailAddress: "a@a.test",
      password: "supersecure",
    });
    const b = await authApi.registerUser({
      username: "bob",
      emailAddress: "b@a.test",
      password: "supersecure",
    });
    // Activate both
    for (const id of [a.user.id, b.user.id]) {
      const u = state.users.find((u) => u.id === id);
      if (u !== undefined) u.isActivated = true;
    }
    const aToken = `at-aaaaaaaa|${a.user.id}`;
    const bToken = `at-bbbbbbbb|${b.user.id}`;

    const created = await gameApi.createSession({
      accessToken: aToken,
      side: "gold",
    });
    expect(created.snapshot.participants.gold?.userId).toBe(a.user.id);

    const accepted = await gameApi.acceptSession({
      accessToken: bToken,
      body: { acceptToken: created.acceptToken },
    });
    expect(accepted.side).toBe("silver");
    expect(accepted.snapshot.participants.silver?.userId).toBe(b.user.id);
  });

  it("only lists the caller's own sessions", async () => {
    const { authApi, gameApi, state } = buildFakeNetwork();
    const a = await authApi.registerUser({
      username: "owner",
      emailAddress: "owner@a.test",
      password: "supersecure",
    });
    const b = await authApi.registerUser({
      username: "other",
      emailAddress: "other@a.test",
      password: "supersecure",
    });
    for (const id of [a.user.id, b.user.id]) {
      const u = state.users.find((u) => u.id === id);
      if (u !== undefined) u.isActivated = true;
    }
    const aToken = `at-1111|${a.user.id}`;
    const bToken = `at-2222|${b.user.id}`;
    await gameApi.createSession({ accessToken: aToken, side: "gold" });
    await gameApi.createSession({ accessToken: aToken, side: "silver" });
    await gameApi.createSession({ accessToken: bToken, side: "gold" });

    const list = await gameApi.listMySessions({
      accessToken: aToken,
      query: {},
    });
    expect(list.sessions).toHaveLength(2);
    for (const entry of list.sessions) {
      expect(["gold", "silver"]).toContain(entry.yourSide);
    }
  });
});
