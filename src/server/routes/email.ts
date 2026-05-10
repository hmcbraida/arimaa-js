/**
 * Email-verification confirmation route.
 *
 * - `POST /api/email-verifications/{token}` -- consume a verification
 *   token and mark the matching account as activated.
 *
 * This endpoint is the second half of the email-verification flow.
 * The "issue a token" half lives on `POST /api/users/me/email/verification`
 * (in `users.ts`) because issuing a token is an operation against the
 * authenticated user, while consuming a token is anonymous (only the
 * token itself proves the caller's right to act).
 */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  emailVerificationParamsSchema,
  emptyResponseSchema,
  errorResponseSchema,
} from "../../shared/schema";
import { hashToken } from "../auth/tokens";
import type { RouteDeps } from "./types";

export function registerEmailRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    "/api/email-verifications/:token",
    {
      schema: {
        params: emailVerificationParamsSchema,
        response: {
          200: emptyResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const consumed = await deps.store.emailVerificationTokens.consumeByHash(
        hashToken(request.params.token),
        deps.now(),
      );
      if (consumed === null) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: "Verification token is invalid or expired",
          code: "verification-invalid",
        });
      }
      // Idempotent: marking an already-activated user as activated is
      // a no-op. The token deletion is what guarantees single-use; the
      // boolean flip is just bookkeeping.
      await deps.store.users.setActivated(consumed.userId, true);
      return {};
    },
  );
}
