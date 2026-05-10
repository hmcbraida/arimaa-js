/**
 * Build the Fastify application around its persistence, event-bus,
 * email, and JWT-signer adapters.
 *
 * The factory is deliberately written to take its dependencies as
 * arguments rather than reaching out to module-level singletons. That
 * way, the production entrypoint (`index.ts`) composes Postgres +
 * NATS + SMTP while the test suite composes the in-memory fakes — and
 * we can write the route handlers exactly once.
 *
 * The route bodies themselves live under `src/server/routes/`; this
 * file just registers the cross-cutting plugins (CORS, websocket,
 * zod type provider, error handler) and wires each route module in.
 */

import cookiePlugin from "@fastify/cookie";
import corsPlugin from "@fastify/cors";
import websocketPlugin from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { AuthTokenSigner } from "./auth/tokens";
import type { EmailSender } from "./email/sender";
import type { EventBus } from "./events/bus";
import type { DataStore } from "./persistence/store";
import { registerAuthRoutes } from "./routes/auth";
import { registerEmailRoutes } from "./routes/email";
import { registerPasswordRoutes } from "./routes/passwords";
import { registerSessionRoutes } from "./routes/sessions";
import type { RouteDeps } from "./routes/types";
import { registerUserRoutes } from "./routes/users";
import { registerWebSocketRoutes } from "./routes/ws";

/**
 * Dependency bundle the server expects. The fields here are the
 * superset of what every route module needs.
 */
export interface ServerDependencies {
  readonly store: DataStore;
  readonly events: EventBus;
  readonly emailSender: EmailSender;
  readonly tokenSigner: AuthTokenSigner;
  /**
   * Public-facing base URL of the SPA. Used to build verification and
   * password-reset links. Trailing slash optional — we trim before
   * appending.
   */
  readonly publicBaseUrl: string;
  /**
   * Optional clock injection. Defaults to `() => new Date()`. Tests
   * override this when they want deterministic timestamps.
   */
  readonly now?: () => Date;
}

export function buildServer(deps: ServerDependencies): FastifyInstance {
  const routeDeps: RouteDeps = {
    store: deps.store,
    events: deps.events,
    emailSender: deps.emailSender,
    tokenSigner: deps.tokenSigner,
    publicBaseUrl: deps.publicBaseUrl,
    now: deps.now ?? (() => new Date()),
    // Secure flag follows the origin scheme: dev uses http, prod uses https.
    secureCookies: deps.publicBaseUrl.startsWith("https:"),
  };

  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  /**
   * CORS is permissive so the SPA, when served from a different
   * origin during local development, can hit the API without a proxy.
   * In docker-compose the SPA is served from the same origin and CORS
   * is never engaged.
   */
  app.register(corsPlugin, { origin: true, credentials: true });
  // Cookie plugin must be registered before route modules so that
  // `request.cookies` and `reply.setCookie` are available.
  app.register(cookiePlugin);
  app.register(websocketPlugin);

  /**
   * Convert validation / auth / generic errors to a uniform response
   * shape — the same as `errorResponseSchema` — so the client
   * validator never sees an envelope with extra fields. We special-
   * case our own `AuthError` to surface its `code` field; everything
   * else falls back to the Fastify-default mapping.
   */
  app.setErrorHandler(
    (error: Error & { statusCode?: number; code?: string }, _req, reply) => {
      const statusCode =
        error.statusCode !== undefined && error.statusCode >= 400
          ? error.statusCode
          : 500;
      // Never leak internal error details to the client for server errors.
      const isServerError = statusCode >= 500;
      const body: {
        statusCode: number;
        error: string;
        message: string;
        code?: string;
      } = {
        statusCode,
        error: isServerError
          ? "Internal Server Error"
          : (error.name ?? "Error"),
        message: isServerError ? "An unexpected error occurred" : error.message,
      };
      if (!isServerError && typeof error.code === "string") {
        body.code = error.code;
      }
      return reply.status(statusCode).send(body);
    },
  );

  // Register each route module. They share the same `routeDeps` and
  // can be reordered freely; the file split is for readability rather
  // than for ordering constraints.
  registerUserRoutes(app, routeDeps);
  registerAuthRoutes(app, routeDeps);
  registerEmailRoutes(app, routeDeps);
  registerPasswordRoutes(app, routeDeps);
  registerSessionRoutes(app, routeDeps);
  registerWebSocketRoutes(app, routeDeps);

  return app;
}

export type { FastifyInstance };
