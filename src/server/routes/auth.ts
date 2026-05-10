/**
 * Authentication / session-token routes.
 *
 * - `POST   /api/auth/login-sessions`                              login
 * - `POST   /api/auth/login-sessions/current/refresh-tokens`       exchange refresh→access
 * - `DELETE /api/auth/login-sessions/current`                      logout
 *
 * The naming follows `docs/auth.md`: a "login session" is the
 * resource the user creates by logging in (it is materialised as a
 * row in `refresh_tokens`); the access tokens are sub-resources of
 * the login session.
 *
 * The refresh endpoint is the one that knows how to express the
 * "valid token, but cannot currently authorise" condition (account
 * not activated, account disabled). It returns a structured
 * `{ ok: false, reason }` payload so the frontend can render the
 * appropriate stuck-on-login screen.
 */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  emptyResponseSchema,
  errorResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  refreshAccessTokenResponseSchema,
} from "../../shared/schema";
import {
  issueRefreshToken,
  tryIssueAccessToken,
  userRecordToProfile,
} from "../auth/issue";
import { verifyPassword } from "../auth/passwords";
import { hashToken } from "../auth/tokens";
import type { RouteDeps } from "./types";

/** Name of the httpOnly cookie that carries the long-lived refresh token. */
const RT_COOKIE = "rt";

/**
 * Cookie options shared by every Set-Cookie call that writes the
 * refresh token. The `expires` field is set per-call since it is
 * token-specific.
 */
function rtCookieOptions(secureCookies: boolean, expiresAt: Date) {
  return {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /* ----------------------------------------------------------------- */
  /* POST /api/auth/login-sessions — login                              */
  /* ----------------------------------------------------------------- */
  typed.post(
    "/api/auth/login-sessions",
    {
      config: {
        /**
         * 10 attempts per minute per IP. Generous enough for a
         * legitimate user who misremembers their password, but low
         * enough to make online brute-force infeasible.
         */
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
      schema: {
        body: loginRequestSchema,
        response: {
          200: loginResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { usernameOrEmail, password } = request.body;
      // Look up by username first, falling back to email, so a user
      // can supply either credential against the same endpoint. This
      // costs at most one extra round-trip on the email path; the
      // username path is the common case.
      const byUsername = await deps.store.users.findByUsername(usernameOrEmail);
      const user =
        byUsername ?? (await deps.store.users.findByEmail(usernameOrEmail));

      // We always run a verification step against a stored hash even
      // when the user was not found, so that the timing of an unknown-
      // user response does not leak that the username was unknown.
      const dummyHash =
        "$argon2id$v=19$m=19456,t=2,p=1$" +
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$" +
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      const targetHash = user?.passwordHash ?? dummyHash;
      const okPassword = await verifyPassword(password, targetHash);

      if (user === null || !okPassword) {
        return reply.status(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message: "Invalid username or password",
          code: "invalid-credentials",
        });
      }

      const now = deps.now();
      const refresh = await issueRefreshToken(deps.store, user, now);
      const access = await tryIssueAccessToken(
        deps.store,
        deps.tokenSigner,
        user,
        now,
      );

      reply.setCookie(
        RT_COOKIE,
        refresh.refreshToken,
        rtCookieOptions(deps.secureCookies, refresh.expiresAt),
      );
      return {
        user: userRecordToProfile(user),
        accessToken: access?.accessToken ?? null,
        accessTokenExpiresAt: access?.expiresAt.toISOString() ?? null,
      };
    },
  );

  /* ----------------------------------------------------------------- */
  /* POST /api/auth/login-sessions/current/refresh-tokens               */
  /* ----------------------------------------------------------------- */
  typed.post(
    "/api/auth/login-sessions/current/refresh-tokens",
    {
      schema: {
        response: {
          200: refreshAccessTokenResponseSchema,
        },
      },
    },
    async (request) => {
      const now = deps.now();
      const rawToken = request.cookies[RT_COOKIE];
      if (rawToken === undefined) {
        return { ok: false as const, reason: "invalid" as const, user: null };
      }
      const tokenHash = hashToken(rawToken);
      const tokenRow = await deps.store.refreshTokens.findActiveByHash(
        tokenHash,
        now,
      );
      if (tokenRow === null) {
        // Bad/expired/revoked token — collapse all three into one
        // response. We do not include a user profile because there
        // is nothing trustworthy to return.
        return { ok: false as const, reason: "invalid" as const, user: null };
      }
      const user = await deps.store.users.getById(tokenRow.userId);
      if (user === null) {
        return { ok: false as const, reason: "invalid" as const, user: null };
      }
      if (user.isDisabled) {
        return {
          ok: false as const,
          reason: "account-disabled" as const,
          user: userRecordToProfile(user),
        };
      }
      if (!user.isActivated) {
        return {
          ok: false as const,
          reason: "account-not-activated" as const,
          user: userRecordToProfile(user),
        };
      }
      const access = await tryIssueAccessToken(
        deps.store,
        deps.tokenSigner,
        user,
        now,
      );
      // tryIssueAccessToken cannot return null here because we have
      // already screened both flags above; if it does, fall back to
      // the conservative `invalid` response rather than throwing.
      if (access === null) {
        return { ok: false as const, reason: "invalid" as const, user: null };
      }
      return {
        ok: true as const,
        accessToken: access.accessToken,
        accessTokenExpiresAt: access.expiresAt.toISOString(),
        user: userRecordToProfile(user),
      };
    },
  );

  /* ----------------------------------------------------------------- */
  /* DELETE /api/auth/login-sessions/current — logout                   */
  /* ----------------------------------------------------------------- */
  /**
   * The body carries the refresh token to revoke. Logout is
   * idempotent: we always return 200 even if the token is unknown or
   * already revoked. That keeps the front-end's logout button safe to
   * click multiple times.
   */
  typed.delete(
    "/api/auth/login-sessions/current",
    {
      schema: {
        response: {
          200: emptyResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const now = deps.now();
      const rawToken = request.cookies[RT_COOKIE];
      if (rawToken !== undefined) {
        const tokenHash = hashToken(rawToken);
        const row = await deps.store.refreshTokens.findActiveByHash(
          tokenHash,
          now,
        );
        if (row !== null) {
          await deps.store.refreshTokens.revoke(row.id, now);
        }
      }
      // Clear the cookie regardless of whether the token was valid.
      // Logout is idempotent — clicking it twice should always succeed.
      reply.clearCookie(RT_COOKIE, { path: "/" });
      return {};
    },
  );
}
