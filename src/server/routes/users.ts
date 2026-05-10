/**
 * User-management routes.
 *
 * - `POST   /api/users`                          create account
 * - `GET    /api/users/me`                       authenticated profile
 * - `DELETE /api/users/me`                       delete the current user
 * - `POST   /api/users/me/email/verification`    resend verification email
 * - `PUT    /api/users/me/password`              change password
 *
 * The endpoints follow the pattern documented in
 * `docs/auth.md` (auth-as-a-resource): the user is a resource at
 * `/users/me`, and operations on related sub-resources hang off that
 * path.
 */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createUserRequestSchema,
  createUserResponseSchema,
  emptyResponseSchema,
  errorResponseSchema,
  resendVerificationRequestSchema,
  userProfileSchema,
} from "../../shared/schema";
import {
  issueRefreshToken,
  tryIssueAccessToken,
  userRecordToProfile,
} from "../auth/issue";
import { requireAccessToken } from "../auth/middleware";
import { hashPassword, verifyPassword } from "../auth/passwords";
import {
  EMAIL_VERIFICATION_TTL_MS,
  generateOpaqueToken,
  hashToken,
} from "../auth/tokens";
import { renderEmailVerification } from "../email/templates";
import { UserUniquenessError } from "../persistence/store";
import type { RouteDeps } from "./types";

/**
 * Body schema for the change-password endpoint. Defined inline here
 * because no other route needs it.
 */
const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

/**
 * Build the verification URL embedded in the email body. We assume
 * the frontend serves a `/verify-email` route that reads the token
 * from the query string.
 */
function buildVerificationUrl(deps: RouteDeps, token: string): string {
  const base = deps.publicBaseUrl.replace(/\/$/, "");
  return `${base}/verify-email?token=${encodeURIComponent(token)}`;
}

/**
 * Issue a verification email for the given user. Used both at
 * registration time (the spec says the frontend follows up with an
 * explicit "send verification" call rather than the server doing it
 * automatically) and from the resend-verification endpoint.
 */
async function sendVerificationEmail(
  deps: RouteDeps,
  user: { id: string; username: string; emailAddress: string },
): Promise<void> {
  const now = deps.now();
  // Drop any prior verification tokens so a redeemed-out-of-order
  // earlier email cannot grant verification after a more recent one
  // is sent.
  await deps.store.emailVerificationTokens.deleteAllForUser(user.id);
  const token = generateOpaqueToken();
  await deps.store.emailVerificationTokens.insert({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
  });
  await deps.emailSender.send(
    renderEmailVerification({
      to: user.emailAddress,
      username: user.username,
      verifyUrl: buildVerificationUrl(deps, token),
    }),
  );
}

export function registerUserRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /* ----------------------------------------------------------------- */
  /* POST /api/users — create an account                                */
  /* ----------------------------------------------------------------- */
  typed.post(
    "/api/users",
    {
      schema: {
        body: createUserRequestSchema,
        response: {
          200: createUserResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { username, emailAddress, password } = request.body;
      const passwordHash = await hashPassword(password);

      let user: Awaited<ReturnType<typeof deps.store.users.createUser>>;
      try {
        user = await deps.store.users.createUser({
          username,
          passwordHash,
          emailAddress: emailAddress.toLowerCase(),
        });
      } catch (err) {
        if (err instanceof UserUniquenessError) {
          return reply.status(409).send({
            statusCode: 409,
            error: "Conflict",
            message: `That ${err.field} is already in use`,
            code: err.field === "username" ? "username-taken" : "email-taken",
          });
        }
        throw err;
      }

      const now = deps.now();
      const refresh = await issueRefreshToken(deps.store, user, now);
      // A freshly-created account is not yet activated, so no access
      // token is minted here. The client stores the refresh token and
      // calls the verification flow next.
      const access = await tryIssueAccessToken(
        deps.store,
        deps.tokenSigner,
        user,
        now,
      );

      return {
        user: userRecordToProfile(user),
        refreshToken: refresh.refreshToken,
        refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
        accessToken: access?.accessToken ?? null,
        accessTokenExpiresAt: access?.expiresAt.toISOString() ?? null,
      };
    },
  );

  /* ----------------------------------------------------------------- */
  /* GET /api/users/me — authenticated profile                          */
  /* ----------------------------------------------------------------- */
  typed.get(
    "/api/users/me",
    {
      schema: {
        response: {
          200: userProfileSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const auth = await requireAccessToken(
        { userStore: deps.store.users, tokenSigner: deps.tokenSigner },
        request,
      );
      return userRecordToProfile(auth.user);
    },
  );

  /* ----------------------------------------------------------------- */
  /* DELETE /api/users/me — hard-delete the account                     */
  /* ----------------------------------------------------------------- */
  typed.delete(
    "/api/users/me",
    {
      schema: {
        response: {
          200: emptyResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const auth = await requireAccessToken(
        { userStore: deps.store.users, tokenSigner: deps.tokenSigner },
        request,
      );
      // FK cascades drop refresh / verification / reset tokens. The
      // session FKs are `ON DELETE SET NULL` so game history survives
      // with anonymous ownership for the affected side.
      await deps.store.users.deleteUser(auth.userId);
      return {};
    },
  );

  /* ----------------------------------------------------------------- */
  /* POST /api/users/me/email/verification — resend                     */
  /* ----------------------------------------------------------------- */
  /**
   * Authenticated via the *refresh token* (in the body) rather than
   * the access token. An unactivated user has a refresh token but
   * cannot exchange it for an access token until they verify, so
   * binding this endpoint to the access token would be a chicken-and-
   * egg problem. The refresh token is sufficient proof of identity
   * for the limited scope of "re-email my own address".
   */
  typed.post(
    "/api/users/me/email/verification",
    {
      schema: {
        body: resendVerificationRequestSchema,
        response: {
          200: emptyResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const now = deps.now();
      const tokenRow = await deps.store.refreshTokens.findActiveByHash(
        hashToken(request.body.refreshToken),
        now,
      );
      if (tokenRow === null) {
        return reply.status(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message: "Invalid refresh token",
          code: "invalid-token",
        });
      }
      const user = await deps.store.users.getById(tokenRow.userId);
      if (user === null) {
        return reply.status(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message: "Token owner no longer exists",
          code: "unknown-user",
        });
      }
      if (user.isDisabled) {
        return reply.status(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message: "Account is disabled",
          code: "account-disabled",
        });
      }
      // Already activated? Nothing to do; we still return 200 so the
      // client cannot infer state from the response code.
      if (user.isActivated) {
        return {};
      }
      await sendVerificationEmail(deps, user);
      return {};
    },
  );

  /* ----------------------------------------------------------------- */
  /* PUT /api/users/me/password — change password                       */
  /* ----------------------------------------------------------------- */
  typed.put(
    "/api/users/me/password",
    {
      schema: {
        body: changePasswordRequestSchema,
        response: {
          200: emptyResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await requireAccessToken(
        { userStore: deps.store.users, tokenSigner: deps.tokenSigner },
        request,
      );
      const { currentPassword, newPassword } = request.body;
      const ok = await verifyPassword(currentPassword, auth.user.passwordHash);
      if (!ok) {
        return reply.status(403).send({
          statusCode: 403,
          error: "Forbidden",
          message: "Current password is incorrect",
          code: "invalid-credentials",
        });
      }
      const newHash = await hashPassword(newPassword);
      await deps.store.users.updatePasswordHash(auth.userId, newHash);
      // Revoke every existing refresh token. The user's other sessions
      // will be forced through a fresh login on the next access-token
      // refresh, which is the correct security posture after a
      // password change.
      await deps.store.refreshTokens.revokeAllForUser(auth.userId, deps.now());
      return {};
    },
  );
}

// Re-export so other route modules (e.g. registration follow-ups in
// tests) can trigger a verification email through the same path.
export { sendVerificationEmail };
