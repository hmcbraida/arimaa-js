/**
 * Persistence interface for the Arimaa session API.
 *
 * The route handlers depend only on this abstract interface, not on any
 * concrete database. Two implementations are shipped:
 *
 * - `InMemorySessionStore` (this directory) used by tests so the suite can
 *   run without external infrastructure.
 * - `PostgresSessionStore` (postgresStore.ts) used in production via Drizzle.
 *
 * Keeping the interface small and explicit (rather than letting the routes
 * touch a query builder directly) means we can grow new persistence
 * backends or storage strategies without auditing every endpoint, and the
 * tests can be ruthlessly fast because they never touch IO.
 */

import type { Side } from "../../game";

/**
 * The full row shape stored for a single session.
 *
 * Tokens are stored as SHA-256 hex digests, never as plaintext. The
 * `acceptTokenHash` is nullable because the token is consumed (cleared) once
 * the second player joins; this is how we encode the "expire when used"
 * requirement without scheduling a delete job.
 *
 * We deliberately store only one of the two sides' tokens at create time and
 * fill in the second on accept. Both fields are nullable so the same row
 * shape can represent both a waiting session and an active one.
 */
export interface SessionRecord {
  readonly id: string;
  readonly transcript: string;
  readonly goldTokenHash: string | null;
  readonly silverTokenHash: string | null;
  readonly acceptTokenHash: string | null;
  /** Which side the accept token, if still active, is for. */
  readonly pendingSide: Side | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The per-session writes produced by accepting an invitation.
 *
 * We use a focused update method (rather than a generic "patch" call) so
 * implementations can express the operation atomically — for instance the
 * postgres implementation issues a single `UPDATE ... WHERE accept_token_hash
 * = $1 AND accept_token_hash IS NOT NULL` to make accept double-spend safe.
 */
export interface SessionAcceptWrite {
  readonly secretTokenHash: string;
}

/**
 * The store interface itself. Methods are deliberately atomic-feeling: each
 * one represents one user-facing operation and either succeeds, returns null
 * for "not found", or throws for genuine fault conditions.
 */
export interface SessionStore {
  /**
   * Insert a brand-new session row.
   *
   * The route handler generates the id, hashes both tokens, and decides
   * which side this token belongs to based on the `?side=` query parameter.
   */
  createSession(input: {
    readonly id: string;
    readonly side: Side;
    readonly secretTokenHash: string;
    readonly acceptTokenHash: string;
    readonly transcript: string;
    readonly now: Date;
  }): Promise<SessionRecord>;

  /**
   * Look up a session by id. Used by `GET /api/sessions/:id` and by the
   * websocket subscription handler to verify the session exists before
   * accepting connections.
   */
  getById(id: string): Promise<SessionRecord | null>;

  /**
   * Atomically consume an accept token by hash and assign the joining
   * player's secret token to the appropriate side.
   *
   * Returns the updated record if the accept token matched and was still
   * active, or null otherwise. Implementations must guarantee that this
   * operation is single-use: two concurrent calls with the same accept
   * token must result in exactly one success and one null.
   */
  consumeAcceptToken(input: {
    readonly acceptTokenHash: string;
    readonly write: SessionAcceptWrite;
    readonly now: Date;
  }): Promise<SessionRecord | null>;

  /**
   * Look up a session and identify which side a presented secret token
   * belongs to, in one query.
   *
   * Returns null if no session has either side's hash matching. The
   * caller's job is to map "null" to a 401 response.
   */
  findSessionByTokenHash(
    sessionId: string,
    tokenHash: string,
  ): Promise<{ session: SessionRecord; side: Side } | null>;

  /**
   * Persist a transcript update produced by a successful move.
   *
   * The implementation should also bump `updatedAt`. We pass `now` in
   * explicitly so tests can use a fixed clock.
   */
  updateTranscript(input: {
    readonly id: string;
    readonly transcript: string;
    readonly now: Date;
  }): Promise<SessionRecord>;
}
