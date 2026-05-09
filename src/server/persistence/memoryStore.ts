/**
 * In-memory implementation of `SessionStore` used by automated tests.
 *
 * The contract is exactly the same as the production postgres-backed
 * implementation. We rely on the JavaScript event loop's single-threaded
 * execution model for the atomicity guarantees the interface requires; in
 * particular `consumeAcceptToken` performs its read and write inside the
 * same synchronous step, so two concurrent callers of the same token cannot
 * both see it as active.
 *
 * Production code should never import this module — it is referenced only
 * from server tests.
 */

import { Side } from "../../game";
import type { SessionAcceptWrite, SessionRecord, SessionStore } from "./store";

/**
 * Concrete in-memory store backed by a `Map<id, SessionRecord>`.
 *
 * The constructor takes no arguments because the store starts empty; tests
 * usually populate it via `createSession` rather than seeding rows directly.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  async createSession(input: {
    readonly id: string;
    readonly side: Side;
    readonly secretTokenHash: string;
    readonly acceptTokenHash: string;
    readonly transcript: string;
    readonly now: Date;
  }): Promise<SessionRecord> {
    if (this.sessions.has(input.id)) {
      // Defensive: the route layer generates UUIDs so collisions are
      // astronomically unlikely, but a duplicate would corrupt state, so
      // we surface it loudly.
      throw new Error(`Session ${input.id} already exists`);
    }

    const record: SessionRecord = {
      id: input.id,
      transcript: input.transcript,
      goldTokenHash: input.side === Side.Gold ? input.secretTokenHash : null,
      silverTokenHash:
        input.side === Side.Silver ? input.secretTokenHash : null,
      acceptTokenHash: input.acceptTokenHash,
      // The accept token, when redeemed, will install the secret for the
      // *opposite* side from the creator. We persist that intention here.
      pendingSide: input.side === Side.Gold ? Side.Silver : Side.Gold,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.sessions.set(record.id, record);
    return record;
  }

  async getById(id: string): Promise<SessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }

  async consumeAcceptToken(input: {
    readonly acceptTokenHash: string;
    readonly write: SessionAcceptWrite;
    readonly now: Date;
  }): Promise<SessionRecord | null> {
    // Linear scan is fine for a test fake; production indexes the column.
    for (const record of this.sessions.values()) {
      if (record.acceptTokenHash !== input.acceptTokenHash) continue;
      if (record.pendingSide === null) continue;

      const updated: SessionRecord = {
        ...record,
        // Install the joining player's hashed token on the side recorded as
        // pending at create time (i.e. the opposite of the creator's side).
        goldTokenHash:
          record.pendingSide === Side.Gold
            ? input.write.secretTokenHash
            : record.goldTokenHash,
        silverTokenHash:
          record.pendingSide === Side.Silver
            ? input.write.secretTokenHash
            : record.silverTokenHash,
        // Clearing the hash is what makes the token single-use. Leaving the
        // pendingSide intact would be misleading once both tokens exist;
        // we null it for symmetry with the postgres implementation.
        acceptTokenHash: null,
        pendingSide: null,
        updatedAt: input.now,
      };
      this.sessions.set(record.id, updated);
      return updated;
    }
    return null;
  }

  async findSessionByTokenHash(
    sessionId: string,
    tokenHash: string,
  ): Promise<{ session: SessionRecord; side: Side } | null> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return null;
    if (session.goldTokenHash === tokenHash) {
      return { session, side: Side.Gold };
    }
    if (session.silverTokenHash === tokenHash) {
      return { session, side: Side.Silver };
    }
    return null;
  }

  async updateTranscript(input: {
    readonly id: string;
    readonly transcript: string;
    readonly now: Date;
  }): Promise<SessionRecord> {
    const existing = this.sessions.get(input.id);
    if (existing === undefined) {
      throw new Error(`Session ${input.id} not found`);
    }
    const updated: SessionRecord = {
      ...existing,
      transcript: input.transcript,
      updatedAt: input.now,
    };
    this.sessions.set(input.id, updated);
    return updated;
  }
}
