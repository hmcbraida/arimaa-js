/**
 * Game-session routes.
 *
 * - `POST /api/sessions`                       create a new game (auth)
 * - `GET  /api/sessions/:id`                   public snapshot
 * - `GET  /api/sessions/:id/accept-token`      accept token for participants (auth)
 * - `POST /api/session-accept`                 join a game by accept code (auth)
 * - `POST /api/sessions/:id/moves`             submit a move (auth)
 * - `GET  /api/users/me/sessions`              list the caller's games (auth)
 *
 * Authentication uses the JWT access token (as opposed to the legacy
 * per-session opaque token). The user id from the token is matched
 * against `gold_user_id` / `silver_user_id` to decide which side the
 * caller is allowed to play.
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { Side } from "../../game";
import {
  type SessionEvent,
  acceptSessionRequestSchema,
  acceptSessionResponseSchema,
  createSessionQuerySchema,
  createSessionResponseSchema,
  errorResponseSchema,
  getSessionAcceptTokenResponseSchema,
  getSessionResponseSchema,
  listUserSessionsQuerySchema,
  listUserSessionsResponseSchema,
  sessionIdParamsSchema,
  submitMoveRequestSchema,
  submitMoveResponseSchema,
} from "../../shared/schema";
import { requireAccessToken } from "../auth/middleware";
import {
  applyMoveToTranscript,
  buildSessionListEntry,
  buildSessionSnapshot,
  createInitialTranscript,
  engineSideToWire,
} from "../domain";
import type { SessionRecord, UserRecord } from "../persistence/store";
import { generateAcceptToken } from "../tokens";
import type { RouteDeps } from "./types";

/**
 * Resolve both participants for a session record so the snapshot
 * builder can attach `(userId, username)` info to the response. A
 * lookup that returns null is fine --  that side is either un-joined or
 * the FK was nulled out by an account deletion.
 */
async function resolveParticipants(
  deps: RouteDeps,
  record: SessionRecord,
): Promise<{ goldUser: UserRecord | null; silverUser: UserRecord | null }> {
  const [goldUser, silverUser] = await Promise.all([
    record.goldUserId === null
      ? Promise.resolve(null)
      : deps.store.users.getById(record.goldUserId),
    record.silverUserId === null
      ? Promise.resolve(null)
      : deps.store.users.getById(record.silverUserId),
  ]);
  return { goldUser, silverUser };
}

export function registerSessionRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /* ----------------------------------------------------------------- */
  /* POST /api/sessions --  create a new game                             */
  /* ----------------------------------------------------------------- */
  typed.post(
    "/api/sessions",
    {
      schema: {
        querystring: createSessionQuerySchema,
        response: {
          200: createSessionResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const auth = await requireAccessToken(
        { userStore: deps.store.users, tokenSigner: deps.tokenSigner },
        request,
      );
      const { side } = request.query;
      const id = randomUUID();
      const acceptToken = generateAcceptToken();

      const record = await deps.store.sessions.createSession({
        id,
        side: side === "gold" ? Side.Gold : Side.Silver,
        creatorUserId: auth.userId,
        acceptToken,
        transcript: createInitialTranscript(),
        now: deps.now(),
      });
      const { goldUser, silverUser } = await resolveParticipants(deps, record);
      const snapshot = buildSessionSnapshot({ record, goldUser, silverUser });

      return { sessionId: id, side, acceptToken, snapshot };
    },
  );

  /* ----------------------------------------------------------------- */
  /* GET /api/sessions/:id --  public snapshot                            */
  /* ----------------------------------------------------------------- */
  typed.get(
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
      const record = await deps.store.sessions.getById(request.params.id);
      if (record === null) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: "Session does not exist",
        });
      }
      const { goldUser, silverUser } = await resolveParticipants(deps, record);
      return buildSessionSnapshot({ record, goldUser, silverUser });
    },
  );

  /* ----------------------------------------------------------------- */
  /* GET /api/sessions/:id/accept-token --  accept token for participant  */
  /* ----------------------------------------------------------------- */
  typed.get(
    "/api/sessions/:id/accept-token",
    {
      schema: {
        params: sessionIdParamsSchema,
        response: {
          200: getSessionAcceptTokenResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await requireAccessToken(
        { userStore: deps.store.users, tokenSigner: deps.tokenSigner },
        request,
      );
      const record = await deps.store.sessions.getById(request.params.id);
      if (record === null) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: "Session does not exist",
        });
      }
      if (
        record.goldUserId !== auth.userId &&
        record.silverUserId !== auth.userId
      ) {
        return reply.status(403).send({
          statusCode: 403,
          error: "Forbidden",
          message: "You are not a participant in this session",
        });
      }
      return { acceptToken: record.acceptToken };
    },
  );

  /* ----------------------------------------------------------------- */
  /* POST /api/session-accept --  second player joins                     */
  /* ----------------------------------------------------------------- */
  typed.post(
    "/api/session-accept",
    {
      schema: {
        body: acceptSessionRequestSchema,
        response: {
          200: acceptSessionResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await requireAccessToken(
        { userStore: deps.store.users, tokenSigner: deps.tokenSigner },
        request,
      );
      const updated = await deps.store.sessions.consumeAcceptToken({
        acceptToken: request.body.acceptToken,
        write: { userId: auth.userId },
        now: deps.now(),
      });
      if (updated === null) {
        // Same response as the legacy implementation: the four cases
        // (unknown / already redeemed / expired / accepting your own
        // session) are folded into a single 404 so an attacker cannot
        // probe accept codes.
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: "Accept token is invalid or already used",
        });
      }
      // Joining a game you are already on is silly but legal --  we
      // could detect it and reject, but the persistence layer cleared
      // the accept token before we got here, so a self-join just sets
      // your own user id on the opposite side, which is a valid game
      // state. (Tests assert this is impossible because the creator
      // cannot also accept.)
      const joiningSide: "gold" | "silver" =
        updated.goldUserId === auth.userId ? "gold" : "silver";

      const { goldUser, silverUser } = await resolveParticipants(deps, updated);
      const snapshot = buildSessionSnapshot({
        record: updated,
        goldUser,
        silverUser,
      });
      // Notify any websocket subscribers that the game has started.
      await deps.events.publish(updated.id, {
        type: "accepted",
        sessionId: updated.id,
        snapshot,
      });

      return { sessionId: updated.id, side: joiningSide, snapshot };
    },
  );

  /* ----------------------------------------------------------------- */
  /* POST /api/sessions/:id/moves --  submit a move                       */
  /* ----------------------------------------------------------------- */
  typed.post(
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
      const auth = await requireAccessToken(
        { userStore: deps.store.users, tokenSigner: deps.tokenSigner },
        request,
      );
      const found = await deps.store.sessions.findUserSide(
        request.params.id,
        auth.userId,
      );
      if (found === null) {
        // Either the session does not exist or the caller has no
        // recorded side on it. We collapse both into 403 so an
        // attacker cannot enumerate session ids.
        return reply.status(403).send({
          statusCode: 403,
          error: "Forbidden",
          message: "You are not a participant in this session",
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
        const status = result.reason === "invalid-move" ? 400 : 409;
        return reply.status(status).send({
          statusCode: status,
          error: status === 409 ? "Conflict" : "Bad Request",
          message: explainApplyError(result.reason),
        });
      }

      const updated = await deps.store.sessions.updateTranscript({
        id: session.id,
        transcript: result.transcript,
        now: deps.now(),
      });
      const { goldUser, silverUser } = await resolveParticipants(deps, updated);
      const snapshot = buildSessionSnapshot({
        record: updated,
        goldUser,
        silverUser,
      });

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
  /* GET /api/users/me/sessions --  paginated list of the user's games    */
  /* ----------------------------------------------------------------- */
  typed.get(
    "/api/users/me/sessions",
    {
      schema: {
        querystring: listUserSessionsQuerySchema,
        response: {
          200: listUserSessionsResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const auth = await requireAccessToken(
        { userStore: deps.store.users, tokenSigner: deps.tokenSigner },
        request,
      );
      const limit = request.query.limit ?? 20;
      const cursor = request.query.cursor ?? null;
      const page = await deps.store.sessions.listForUser({
        userId: auth.userId,
        cursor,
        limit,
      });
      const entries = await Promise.all(
        page.sessions.map(async (record) => {
          const { goldUser, silverUser } = await resolveParticipants(
            deps,
            record,
          );
          return buildSessionListEntry({
            record,
            goldUser,
            silverUser,
            viewerUserId: auth.userId,
          });
        }),
      );
      return { sessions: entries, nextCursor: page.nextCursor };
    },
  );
}

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
