/**
 * Build the Fastify application around its persistence and event-bus
 * adapters.
 *
 * The factory is deliberately written to take its dependencies as
 * arguments rather than reaching out to module-level singletons. That
 * way, the production entrypoint composes Postgres + NATS while tests
 * compose the in-memory fakes — and we can write the route handlers
 * exactly once.
 *
 * Note that the file does not start the server; it just builds and
 * configures one. Production starts it from `index.ts`; tests start it
 * by calling `app.inject(...)` which never opens a real socket.
 */

import { randomUUID } from "node:crypto";
import corsPlugin from "@fastify/cors";
import websocketPlugin from "@fastify/websocket";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { Side } from "../game";
import {
  type SessionEvent,
  type SessionSnapshot,
  acceptSessionRequestSchema,
  acceptSessionResponseSchema,
  createSessionQuerySchema,
  createSessionResponseSchema,
  errorResponseSchema,
  getSessionResponseSchema,
  sessionIdParamsSchema,
  submitMoveRequestSchema,
  submitMoveResponseSchema,
} from "../shared/schema";
import {
  applyMoveToTranscript,
  buildSessionSnapshot,
  createInitialTranscript,
  engineSideToWire,
} from "./domain";
import type { EventBus } from "./events/bus";
import type { SessionRecord, SessionStore } from "./persistence/store";
import { generateAcceptToken, generateSecretToken, hashToken } from "./tokens";

/**
 * Dependency bundle the route handlers need.
 *
 * Composing the server from an explicit dependency object (rather than
 * reaching for module-scoped state) is what makes tests fast and
 * deterministic. The same `buildServer` function is called from
 * `tests/buildTestServer.ts` and from `index.ts` with different bundles.
 */
export interface ServerDependencies {
  readonly store: SessionStore;
  readonly events: EventBus;
  /**
   * Optional clock injection. Defaults to `() => new Date()`. Tests can
   * override this if they ever need deterministic timestamps; today none
   * of them do, but having the seam costs nothing.
   */
  readonly now?: () => Date;
}

/**
 * Translate a raw `Authorization` header value into the bearer token, or
 * null if the scheme is wrong / missing.
 *
 * Pulled out into a helper so the routes do not duplicate the prefix
 * matching, and so we can centrally enforce the case rules.
 */
function extractBearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match === null ? null : match[1];
}

/**
 * Compose a public snapshot from a stored record.
 *
 * `hasOpponent` is true when *both* sides have a token, i.e. the
 * invitation has been accepted. We compute it once here so route code
 * can stay terse.
 */
function snapshotFromRecord(record: SessionRecord): SessionSnapshot {
  const hasOpponent =
    record.goldTokenHash !== null && record.silverTokenHash !== null;
  return buildSessionSnapshot({
    id: record.id,
    transcript: record.transcript,
    hasOpponent,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

/**
 * Fastify factory. Returns an unstarted server instance.
 *
 * `withTypeProvider<ZodTypeProvider>()` rewires Fastify so route schemas
 * are accepted as raw zod schemas. The validator compiler turns those
 * into a runtime validator; the serializer compiler enforces the same
 * shape on responses.
 */
export function buildServer(deps: ServerDependencies): FastifyInstance {
  const now = deps.now ?? (() => new Date());
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  /**
   * CORS is registered with permissive settings so the SPA, when served
   * from a different origin during local development, can hit the API
   * without a proxy. In docker-compose the SPA is served from the same
   * origin and CORS is never engaged.
   */
  app.register(corsPlugin, { origin: true, credentials: true });

  /**
   * The websocket plugin attaches a `wsHandler` capability to routes. We
   * scope it to the API so HTTP routes are unaffected.
   */
  app.register(websocketPlugin);

  /**
   * Convert validation errors to a uniform response shape — the same as
   * `errorResponseSchema` — so the client validator never sees an
   * envelope with extra fields.
   */
  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    const statusCode =
      error.statusCode !== undefined && error.statusCode >= 400
        ? error.statusCode
        : 500;
    return reply.status(statusCode).send({
      statusCode,
      error: error.name ?? "Error",
      message: error.message,
    });
  });

  /* ----------------------------------------------------------------- */
  /* POST /api/sessions — create a new game                             */
  /* ----------------------------------------------------------------- */
  app.post(
    "/api/sessions",
    {
      schema: {
        querystring: createSessionQuerySchema,
        response: {
          200: createSessionResponseSchema,
          400: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { side } = request.query;
      const id = randomUUID();
      // Tokens are generated up here so we can show the plaintext to the
      // caller and store only the hashes.
      const secretToken = generateSecretToken();
      const acceptToken = generateAcceptToken();

      await deps.store.createSession({
        id,
        side: side === "gold" ? Side.Gold : Side.Silver,
        secretTokenHash: hashToken(secretToken),
        acceptTokenHash: hashToken(acceptToken),
        transcript: createInitialTranscript(),
        now: now(),
      });

      return { sessionId: id, side, secretToken, acceptToken };
    },
  );

  /* ----------------------------------------------------------------- */
  /* GET /api/sessions/:id — public snapshot                            */
  /* ----------------------------------------------------------------- */
  app.get(
    "/api/sessions/:id",
    {
      schema: {
        params: sessionIdParamsSchema,
        response: {
          200: getSessionResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const record = await deps.store.getById(request.params.id);
      if (record === null) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: "Session does not exist",
        });
      }
      return snapshotFromRecord(record);
    },
  );

  /* ----------------------------------------------------------------- */
  /* POST /api/session-accept — second player joins                     */
  /* ----------------------------------------------------------------- */
  app.post(
    "/api/session-accept",
    {
      schema: {
        body: acceptSessionRequestSchema,
        response: {
          200: acceptSessionResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const secretToken = generateSecretToken();
      const updated = await deps.store.consumeAcceptToken({
        acceptTokenHash: hashToken(request.body.acceptToken),
        write: { secretTokenHash: hashToken(secretToken) },
        now: now(),
      });
      if (updated === null) {
        // We collapse "not found", "already redeemed", and "expired" into
        // a single 404 to avoid leaking which one applied. The accept
        // token is the only knowledge a guesser has, and we do not want
        // to confirm guesses by distinguishing these cases.
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: "Accept token is invalid or already used",
        });
      }
      // The joining player gets the side that was stored as `pendingSide`
      // before consumption, which is now reflected by which token hash
      // is null after the update.
      const joiningSide: "gold" | "silver" =
        updated.goldTokenHash === hashToken(secretToken) ? "gold" : "silver";

      const snapshot = snapshotFromRecord(updated);
      // Publish an `accepted` event so the original creator's connected
      // websocket clients learn the game has started.
      await deps.events.publish(updated.id, {
        type: "accepted",
        sessionId: updated.id,
        snapshot,
      });

      return {
        sessionId: updated.id,
        side: joiningSide,
        secretToken,
      };
    },
  );

  /* ----------------------------------------------------------------- */
  /* POST /api/sessions/:id/moves — authenticated move submission       */
  /* ----------------------------------------------------------------- */
  app.post(
    "/api/sessions/:id/moves",
    {
      schema: {
        params: sessionIdParamsSchema,
        body: submitMoveRequestSchema,
        response: {
          200: submitMoveResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const token = extractBearerToken(request.headers.authorization);
      if (token === null) {
        return reply.status(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message: "Missing bearer token",
        });
      }
      const found = await deps.store.findSessionByTokenHash(
        request.params.id,
        hashToken(token),
      );
      if (found === null) {
        return reply.status(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message: "Token does not authorize this session",
        });
      }
      const { session, side } = found;
      const expectedSide = engineSideToWire(side);
      const result = applyMoveToTranscript(
        session.transcript,
        request.body.moveNotation,
        expectedSide,
      );
      if (!result.ok) {
        // 409 (conflict) is appropriate for "wrong-turn" and "game-over"
        // because the request is well-formed but the resource state
        // forbids it. 400 covers the structurally invalid case.
        const status = result.reason === "invalid-move" ? 400 : 409;
        return reply.status(status).send({
          statusCode: status,
          error: status === 409 ? "Conflict" : "Bad Request",
          message: explainApplyError(result.reason),
        });
      }

      const updated = await deps.store.updateTranscript({
        id: session.id,
        transcript: result.transcript,
        now: now(),
      });

      const snapshot = snapshotFromRecord(updated);
      // Publish a `move` event for any websocket subscribers.
      const lastMove = snapshot.moveLog[snapshot.moveLog.length - 1];
      if (lastMove !== undefined) {
        const moveEvent: SessionEvent = {
          type: "move",
          sessionId: updated.id,
          move: lastMove,
          snapshot,
        };
        await deps.events.publish(updated.id, moveEvent);
      }
      // If the move ended the game, also publish a dedicated completion
      // event for client convenience.
      if (
        snapshot.status === "completed" &&
        snapshot.winner !== null &&
        snapshot.reason !== null
      ) {
        await deps.events.publish(updated.id, {
          type: "completed",
          sessionId: updated.id,
          winner: snapshot.winner,
          reason: snapshot.reason,
          snapshot,
        });
      }

      return { snapshot };
    },
  );

  /* ----------------------------------------------------------------- */
  /* WS /api/ws?sessionId=... — event stream                            */
  /* ----------------------------------------------------------------- */
  /**
   * Websocket route. Clients connect with `?sessionId=<uuid>`; the
   * server verifies the session exists, subscribes to the event bus,
   * and forwards each event as a JSON frame.
   *
   * Reading the session is not authenticated (matching the open `GET`
   * endpoint), so the websocket does not require a token either. If we
   * later need private games, we would add bearer-token query auth here
   * and check the token hash against the session before subscribing.
   */
  app.register(async (scoped) => {
    scoped.get(
      "/api/ws",
      { websocket: true },
      async (
        socket: import("ws").WebSocket,
        request: FastifyRequest,
      ): Promise<void> => {
        const sessionId = (request.query as { sessionId?: string })?.sessionId;
        if (typeof sessionId !== "string" || sessionId.length === 0) {
          socket.close(1008, "Missing sessionId");
          return;
        }

        const record = await deps.store.getById(sessionId);
        if (record === null) {
          socket.close(1008, "Unknown session");
          return;
        }

        const unsubscribe = await deps.events.subscribe(sessionId, (event) => {
          // The websocket may have closed in the interim; we silently
          // drop sends in that case rather than throwing.
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(event));
          }
        });

        socket.on("close", () => {
          void unsubscribe();
        });
      },
    );
  });

  return app;
}

/**
 * Convert an `applyMoveToTranscript` failure reason into a user-facing
 * message. Kept out of the route body so the route reads as a single
 * top-to-bottom flow.
 */
function explainApplyError(
  reason: "wrong-turn" | "game-over" | "invalid-move",
): string {
  switch (reason) {
    case "wrong-turn":
      return "It is not your turn to move";
    case "game-over":
      return "The game is already complete";
    case "invalid-move":
      return "The move is not legal in this position";
  }
}

/**
 * Helper used by tests when they want a typed reply object. Exported
 * from this module purely so the test files can reuse the type without
 * pulling in the full Fastify type machinery.
 */
export type { FastifyInstance, FastifyReply };
