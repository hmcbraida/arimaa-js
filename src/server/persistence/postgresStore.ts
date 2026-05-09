/**
 * Postgres-backed implementation of `SessionStore`.
 *
 * The implementation uses Drizzle's typed query builder, but the methods
 * here are deliberately written to look like the shape of the abstract
 * interface, not the shape of the database. That keeps every method
 * single-purpose and prevents the sort of slow drift between persistence
 * and routes that comes from exposing query objects to handlers.
 */

import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Side } from "../../game";
import { sessions } from "./schema";
import type { SessionAcceptWrite, SessionRecord, SessionStore } from "./store";

/**
 * Concrete store accepting a Drizzle DB handle.
 *
 * The DB is constructed once at server startup and shared across all
 * instances of this class (typically there is exactly one). We accept it
 * via the constructor rather than importing a module-level singleton so
 * tests of the postgres adapter (if we add any later) can pass a mock.
 */
export class PostgresSessionStore implements SessionStore {
  public constructor(private readonly db: NodePgDatabase) {}

  async createSession(input: {
    readonly id: string;
    readonly side: Side;
    readonly secretTokenHash: string;
    readonly acceptTokenHash: string;
    readonly transcript: string;
    readonly now: Date;
  }): Promise<SessionRecord> {
    const [row] = await this.db
      .insert(sessions)
      .values({
        id: input.id,
        transcript: input.transcript,
        goldTokenHash: input.side === Side.Gold ? input.secretTokenHash : null,
        silverTokenHash:
          input.side === Side.Silver ? input.secretTokenHash : null,
        acceptTokenHash: input.acceptTokenHash,
        // The accept token, when redeemed, will install a secret on the
        // *opposite* side from the creator. We persist that intention.
        pendingSide: input.side === Side.Gold ? "silver" : "gold",
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();
    return rowToRecord(row);
  }

  async getById(id: string): Promise<SessionRecord | null> {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    return row === undefined ? null : rowToRecord(row);
  }

  async consumeAcceptToken(input: {
    readonly acceptTokenHash: string;
    readonly write: SessionAcceptWrite;
    readonly now: Date;
  }): Promise<SessionRecord | null> {
    /**
     * Single-statement update: this is what makes the operation
     * single-use even under concurrent calls. The `WHERE
     * accept_token_hash IS NOT NULL` clause is the one that prevents
     * a second redemption — once the column is null the predicate
     * fails and zero rows are updated.
     *
     * We use `CASE` to set the right side's column based on the
     * pending_side enum we stored at create time. The other side's
     * column is left untouched.
     */
    const updated = await this.db
      .update(sessions)
      .set({
        goldTokenHash: sql`CASE WHEN ${sessions.pendingSide} = 'gold' THEN ${input.write.secretTokenHash} ELSE ${sessions.goldTokenHash} END`,
        silverTokenHash: sql`CASE WHEN ${sessions.pendingSide} = 'silver' THEN ${input.write.secretTokenHash} ELSE ${sessions.silverTokenHash} END`,
        acceptTokenHash: null,
        pendingSide: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(sessions.acceptTokenHash, input.acceptTokenHash),
          isNotNull(sessions.acceptTokenHash),
        ),
      )
      .returning();

    return updated[0] === undefined ? null : rowToRecord(updated[0]);
  }

  async findSessionByTokenHash(
    sessionId: string,
    tokenHash: string,
  ): Promise<{ session: SessionRecord; side: Side } | null> {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (row === undefined) return null;
    if (row.goldTokenHash === tokenHash) {
      return { session: rowToRecord(row), side: Side.Gold };
    }
    if (row.silverTokenHash === tokenHash) {
      return { session: rowToRecord(row), side: Side.Silver };
    }
    return null;
  }

  async updateTranscript(input: {
    readonly id: string;
    readonly transcript: string;
    readonly now: Date;
  }): Promise<SessionRecord> {
    const [row] = await this.db
      .update(sessions)
      .set({ transcript: input.transcript, updatedAt: input.now })
      .where(eq(sessions.id, input.id))
      .returning();
    if (row === undefined) {
      throw new Error(`Session ${input.id} not found`);
    }
    return rowToRecord(row);
  }
}

/**
 * Translate a Drizzle row into the persistence-layer `SessionRecord`.
 *
 * The two shapes are nearly identical, but the Drizzle row uses the
 * Postgres enum type ("gold" | "silver" | null) while the rest of the
 * server code uses the engine's `Side` enum. Converting once here keeps
 * the rest of the surface clean.
 */
function rowToRecord(row: {
  id: string;
  transcript: string;
  goldTokenHash: string | null;
  silverTokenHash: string | null;
  acceptTokenHash: string | null;
  pendingSide: "gold" | "silver" | null;
  createdAt: Date;
  updatedAt: Date;
}): SessionRecord {
  return {
    id: row.id,
    transcript: row.transcript,
    goldTokenHash: row.goldTokenHash,
    silverTokenHash: row.silverTokenHash,
    acceptTokenHash: row.acceptTokenHash,
    pendingSide:
      row.pendingSide === null
        ? null
        : row.pendingSide === "gold"
          ? Side.Gold
          : Side.Silver,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
