/**
 * Shared API contract for the Arimaa networked-play API.
 *
 * Both the Fastify server and the browser-side network client import the same
 * zod schemas from this module so the wire format has exactly one definition.
 * The server uses these schemas to validate incoming bodies and to serialize
 * outgoing responses with confidence; the client uses them to verify that
 * server responses match the contract before handing data to the UI layer.
 *
 * Keeping the schemas in `src/shared` (rather than under `src/server`) is
 * intentional: the contract is part of the public surface of the application,
 * not an implementation detail of the backend.
 */

import { z } from "zod";

/* --------------------------------------------------------------------- */
/* Primitive value schemas                                               */
/* --------------------------------------------------------------------- */

/**
 * The two Arimaa sides as represented over the wire.
 *
 * The Arimaa engine has its own `Side` enum with the same string values, but we
 * deliberately re-declare the constraint here so the public API surface does
 * not have to depend on a specific TypeScript export from the engine.
 */
export const sideSchema = z.enum(["gold", "silver"]);
export type Side = z.infer<typeof sideSchema>;

/**
 * The lifecycle states of a game session.
 *
 * - `waiting`   the creator has not yet been joined by an opponent.
 * - `gold`      gold's turn to move.
 * - `silver`    silver's turn to move.
 * - `completed` the game has ended; no further moves are possible.
 */
export const sessionStatusSchema = z.enum([
  "waiting",
  "gold",
  "silver",
  "completed",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/**
 * Reason the game finished, mirroring the engine's `GameOutcomeReason`.
 *
 * This is only meaningful when `status === "completed"`.
 */
export const gameOutcomeReasonSchema = z.enum([
  "goal",
  "rabbit-loss",
  "immobilized",
  "repetition",
]);
export type GameOutcomeReason = z.infer<typeof gameOutcomeReasonSchema>;

/* --------------------------------------------------------------------- */
/* Game state snapshot                                                    */
/* --------------------------------------------------------------------- */

/**
 * A single committed move as published in a session snapshot.
 *
 * We intentionally keep the per-step structural detail off the wire; the
 * notation field is the canonical record of what was played, and the client
 * can re-derive everything else by replaying the transcript through the
 * existing engine if it needs richer structural data.
 */
export const sessionMoveLogEntrySchema = z.object({
  moveNumber: z.number().int().nonnegative(),
  side: sideSchema,
  notation: z.string(),
});
export type SessionMoveLogEntry = z.infer<typeof sessionMoveLogEntrySchema>;

/**
 * The opponent winner field uses the same side schema; we re-export it as a
 * named alias purely for readability when consumed at the call site.
 */
export const sessionWinnerSchema = sideSchema;

/**
 * The complete public view of a session.
 *
 * The transcript field is the engine's setup-and-moves transcript; this is
 * what the client uses to reconstruct an `ArimaaGame` locally without needing
 * to receive a fully-decoded board over the wire (which would couple the API
 * contract to the engine's snapshot shape).
 */
export const sessionSnapshotSchema = z.object({
  id: z.string().uuid(),
  status: sessionStatusSchema,
  /**
   * Whose turn it is right now, or `null` while the session is waiting for an
   * opponent or after it has completed.
   */
  sideToMove: sideSchema.nullable(),
  /**
   * The complete engine transcript (setup lines plus all committed moves).
   * Always populated, even in the `waiting` state, where it just contains the
   * default Gold and Silver setups.
   */
  transcript: z.string(),
  moveLog: z.array(sessionMoveLogEntrySchema),
  /** Populated only when the session has finished. */
  winner: sessionWinnerSchema.nullable(),
  reason: gameOutcomeReasonSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;

/* --------------------------------------------------------------------- */
/* HTTP request / response shapes                                         */
/* --------------------------------------------------------------------- */

/**
 * `POST /api/sessions?side=gold|silver` query parameters.
 *
 * Modelled as a separate schema so it can be supplied directly to Fastify's
 * `querystring` route slot via the type provider.
 */
export const createSessionQuerySchema = z.object({
  side: sideSchema,
});
export type CreateSessionQuery = z.infer<typeof createSessionQuerySchema>;

/**
 * `POST /api/sessions` response.
 *
 * `secretToken` is shown to the caller exactly once and never persisted on the
 * server in plaintext. `acceptToken` is the eight-digit shareable code; it
 * also is shown only once so the caller is responsible for retaining it.
 */
export const createSessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  side: sideSchema,
  secretToken: z.string(),
  acceptToken: z.string().regex(/^\d{8}$/),
});
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;

/**
 * `POST /api/session-accept` body — the eight-digit code shared by the
 * original creator. Only the digit format is validated here; the server then
 * checks the code against the persisted hash.
 */
export const acceptSessionRequestSchema = z.object({
  acceptToken: z.string().regex(/^\d{8}$/),
});
export type AcceptSessionRequest = z.infer<typeof acceptSessionRequestSchema>;

/**
 * `POST /api/session-accept` response — the joining player's side and their
 * secret move-authorization token.
 */
export const acceptSessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  side: sideSchema,
  secretToken: z.string(),
});
export type AcceptSessionResponse = z.infer<typeof acceptSessionResponseSchema>;

/**
 * `POST /api/sessions/:id/moves` body. The move is the full Arimaa long-form
 * move notation for one turn (a space-separated list of step notations). The
 * server validates the move by replaying the existing transcript through the
 * engine and asking the engine to apply this move.
 */
export const submitMoveRequestSchema = z.object({
  moveNotation: z.string().min(1),
});
export type SubmitMoveRequest = z.infer<typeof submitMoveRequestSchema>;

/**
 * `POST /api/sessions/:id/moves` response — the post-move snapshot so the
 * client can synchronize its UI without making a second `GET` round-trip.
 */
export const submitMoveResponseSchema = z.object({
  snapshot: sessionSnapshotSchema,
});
export type SubmitMoveResponse = z.infer<typeof submitMoveResponseSchema>;

/**
 * `GET /api/sessions/:id` URL parameters.
 */
export const sessionIdParamsSchema = z.object({
  id: z.string().uuid(),
});
export type SessionIdParams = z.infer<typeof sessionIdParamsSchema>;

/**
 * `GET /api/sessions/:id` response — exactly the public snapshot shape.
 */
export const getSessionResponseSchema = sessionSnapshotSchema;
export type GetSessionResponse = z.infer<typeof getSessionResponseSchema>;

/**
 * Standard error body shape used by the API.
 *
 * Fastify's default error format is JSON-serializable, but we keep a slim
 * declared schema so the client can validate error envelopes too.
 */
export const errorResponseSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/* --------------------------------------------------------------------- */
/* WebSocket events                                                       */
/* --------------------------------------------------------------------- */

/**
 * Event published when a player joins a waiting session.
 *
 * The new state is included so the client does not need to make a follow-up
 * GET request just to learn whose turn it now is.
 */
export const sessionAcceptedEventSchema = z.object({
  type: z.literal("accepted"),
  sessionId: z.string().uuid(),
  snapshot: sessionSnapshotSchema,
});
export type SessionAcceptedEvent = z.infer<typeof sessionAcceptedEventSchema>;

/**
 * Event published when a move is committed to a session.
 *
 * Includes both the move just played (so naïve consumers can append to a UI
 * log without recomputing) and the resulting snapshot.
 */
export const sessionMoveEventSchema = z.object({
  type: z.literal("move"),
  sessionId: z.string().uuid(),
  move: sessionMoveLogEntrySchema,
  snapshot: sessionSnapshotSchema,
});
export type SessionMoveEvent = z.infer<typeof sessionMoveEventSchema>;

/**
 * Event published when the game ends after a committed move.
 *
 * This is functionally redundant with the `move` event whose snapshot already
 * shows `status === "completed"`, but a dedicated event makes it easy for
 * client code to react to game completion without examining snapshot state.
 */
export const sessionCompletedEventSchema = z.object({
  type: z.literal("completed"),
  sessionId: z.string().uuid(),
  winner: sessionWinnerSchema,
  reason: gameOutcomeReasonSchema,
  snapshot: sessionSnapshotSchema,
});
export type SessionCompletedEvent = z.infer<typeof sessionCompletedEventSchema>;

/**
 * Discriminated union of all events that may flow over the WebSocket for a
 * single session subscription.
 */
export const sessionEventSchema = z.discriminatedUnion("type", [
  sessionAcceptedEventSchema,
  sessionMoveEventSchema,
  sessionCompletedEventSchema,
]);
export type SessionEvent = z.infer<typeof sessionEventSchema>;
