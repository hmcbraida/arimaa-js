/**
 * Password-reset routes.
 *
 * - `POST /api/passwords/resets`             request a reset link
 * - `POST /api/passwords/resets/{token}`     complete the reset
 *
 * The flow is the standard "reset is its own resource" pattern: the
 * client first creates a reset request (which the server fulfils by
 * emailing a single-use token to the address), then the user clicks
 * the email link and the frontend calls the second endpoint with the
 * token plus their chosen new password.
 *
 * Both endpoints leak as little as possible: requesting a reset for a
 * non-existent email returns 200 (so an attacker cannot probe which
 * addresses have accounts), and consuming an invalid or expired token
 * returns the same 404 the deterministic `verification-invalid` path
 * uses.
 */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  completePasswordResetSchema,
  emptyResponseSchema,
  errorResponseSchema,
  passwordResetTokenParamsSchema,
  requestPasswordResetSchema,
} from "../../shared/schema";
import { hashPassword } from "../auth/passwords";
import {
  PASSWORD_RESET_TTL_MS,
  generateOpaqueToken,
  hashToken,
} from "../auth/tokens";
import { renderPasswordReset } from "../email/templates";
import type { RouteDeps } from "./types";

/**
 * Build the reset URL embedded in the email body. Mirrors the
 * verification-URL construction in `users.ts`; the path lives at
 * `/reset-password?token=…` on the frontend.
 */
function buildResetUrl(deps: RouteDeps, token: string): string {
  const base = deps.publicBaseUrl.replace(/\/$/, "");
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

export function registerPasswordRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /* ----------------------------------------------------------------- */
  /* POST /api/passwords/resets — request a reset                       */
  /* ----------------------------------------------------------------- */
  typed.post(
    "/api/passwords/resets",
    {
      schema: {
        body: requestPasswordResetSchema,
        response: {
          200: emptyResponseSchema,
        },
      },
    },
    async (request) => {
      const user = await deps.store.users.findByEmail(
        request.body.emailAddress,
      );
      // Always respond 200 with an empty body, irrespective of whether
      // an account exists. This prevents account-existence probing.
      if (user === null) return {};

      const now = deps.now();
      // Drop any prior outstanding tokens so that an earlier email can
      // not reset the password to something the attacker chose first.
      await deps.store.passwordResetTokens.deleteAllForUser(user.id);
      const token = generateOpaqueToken();
      await deps.store.passwordResetTokens.insert({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
      });
      await deps.emailSender.send(
        renderPasswordReset({
          to: user.emailAddress,
          username: user.username,
          resetUrl: buildResetUrl(deps, token),
        }),
      );
      return {};
    },
  );

  /* ----------------------------------------------------------------- */
  /* POST /api/passwords/resets/{token} — complete the reset             */
  /* ----------------------------------------------------------------- */
  typed.post(
    "/api/passwords/resets/:token",
    {
      schema: {
        params: passwordResetTokenParamsSchema,
        body: completePasswordResetSchema,
        response: {
          200: emptyResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const now = deps.now();
      const consumed = await deps.store.passwordResetTokens.consumeByHash(
        hashToken(request.params.token),
        now,
      );
      if (consumed === null) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: "Reset token is invalid or expired",
          code: "reset-invalid",
        });
      }
      const newHash = await hashPassword(request.body.newPassword);
      await deps.store.users.updatePasswordHash(consumed.userId, newHash);
      // Revoke every refresh token for the user. A successful password
      // reset must invalidate any session that was open at the time
      // the password was compromised (which is the most likely reason
      // a reset was requested).
      await deps.store.refreshTokens.revokeAllForUser(consumed.userId, now);
      return {};
    },
  );
}
