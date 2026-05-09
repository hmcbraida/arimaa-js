/**
 * Drizzle ORM schema for the session-API database.
 *
 * This file is the single source of truth for the table layout. The Drizzle
 * Kit migration generator reads this schema, diffs it against the current
 * migration history, and produces the SQL we ship in `src/server/migrations`.
 *
 * The schema is small on purpose. The Arimaa engine already round-trips a
 * complete game through a transcript string, so we store that string and
 * derive everything else (board, side to move, status, move log) by replay.
 * That keeps the DB layer decoupled from engine-internal types.
 */

import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * The `pendingSide` column records which side a still-active accept token
 * will be redeemed onto. Using a Postgres enum (rather than a free-text
 * column) makes invalid values impossible to write.
 */
export const sessionSideEnum = pgEnum("session_side", ["gold", "silver"]);

export const sessions = pgTable("sessions", {
  /**
   * Stable session identifier. UUID v4 to make ids both globally unique and
   * unguessable; the public `GET /api/sessions/:id` route does not require
   * authorization, but unguessable ids still keep casual enumeration off the
   * table.
   */
  id: uuid("id").primaryKey(),

  /**
   * Engine transcript representing the full game state, including the
   * default setup and every committed move so far. Always stored — never
   * null — even immediately after creation, because the initial setup is
   * itself part of the transcript.
   */
  transcript: text("transcript").notNull(),

  /**
   * SHA-256 hex digests of the per-side player secret tokens. Both columns
   * are nullable because at session create time only one side has a token;
   * the other is filled in when an opponent redeems the accept token.
   */
  goldTokenHash: text("gold_token_hash"),
  silverTokenHash: text("silver_token_hash"),

  /**
   * SHA-256 hash of the eight-digit accept code. Cleared on first successful
   * use — that is how we encode the "expire when used" requirement without
   * needing a periodic cleanup job.
   */
  acceptTokenHash: text("accept_token_hash"),

  /**
   * Which side the still-active accept token will be assigned to when
   * redeemed. Always the opposite of the creator's side. Cleared together
   * with `acceptTokenHash`.
   */
  pendingSide: sessionSideEnum("pending_side"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
