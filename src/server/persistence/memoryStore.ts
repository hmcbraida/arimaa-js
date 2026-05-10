/**
 * In-memory implementations of the persistence interfaces.
 *
 * These are the test doubles for the Postgres-backed stores. They
 * implement exactly the same contracts so route handlers tested here
 * exercise the same call shapes that production exercises against the
 * real database.
 *
 * The atomicity guarantees the contracts demand are satisfied for free
 * by the JavaScript event loop: every read-then-write is performed in
 * a single synchronous step, so two concurrent callers cannot
 * interleave inside one method.
 *
 * Production code must never import this module — it is referenced
 * only from tests.
 */

import { randomUUID } from "node:crypto";
import { Side } from "../../game";
import type {
  DataStore,
  EmailVerificationTokenRecord,
  EmailVerificationTokenStore,
  PasswordResetTokenRecord,
  PasswordResetTokenStore,
  RefreshTokenRecord,
  RefreshTokenStore,
  SessionAcceptWrite,
  SessionListPage,
  SessionRecord,
  SessionStore,
  UserRecord,
  UserStore,
} from "./store";
import { UserUniquenessError } from "./store";

/* ===================================================================== */
/* Session store                                                          */
/* ===================================================================== */

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  async createSession(input: {
    readonly id: string;
    readonly side: Side;
    readonly creatorUserId: string;
    readonly acceptTokenHash: string;
    readonly transcript: string;
    readonly now: Date;
  }): Promise<SessionRecord> {
    if (this.sessions.has(input.id)) {
      throw new Error(`Session ${input.id} already exists`);
    }

    const record: SessionRecord = {
      id: input.id,
      transcript: input.transcript,
      goldUserId: input.side === Side.Gold ? input.creatorUserId : null,
      silverUserId: input.side === Side.Silver ? input.creatorUserId : null,
      acceptTokenHash: input.acceptTokenHash,
      // The accept token, when redeemed, will install the joining
      // user as the *opposite* side from the creator.
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
        // Install the joining user on the side recorded as pending at
        // create time (the opposite of the creator's side).
        goldUserId:
          record.pendingSide === Side.Gold
            ? input.write.userId
            : record.goldUserId,
        silverUserId:
          record.pendingSide === Side.Silver
            ? input.write.userId
            : record.silverUserId,
        // Clearing the hash is what makes the token single-use.
        acceptTokenHash: null,
        pendingSide: null,
        updatedAt: input.now,
      };
      this.sessions.set(record.id, updated);
      return updated;
    }
    return null;
  }

  async findUserSide(
    sessionId: string,
    userId: string,
  ): Promise<{ session: SessionRecord; side: Side } | null> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return null;
    if (session.goldUserId === userId) {
      return { session, side: Side.Gold };
    }
    if (session.silverUserId === userId) {
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

  async listForUser(input: {
    readonly userId: string;
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<SessionListPage> {
    /**
     * Page through the user's sessions in createdAt-desc order.
     *
     * The cursor format is `<isoTimestamp>|<sessionId>` and represents
     * the LAST row included on the previous page. We yield rows
     * strictly older-than (or equal-id-tiebreaker-after) the cursor.
     */
    const all = [...this.sessions.values()]
      .filter(
        (s) => s.goldUserId === input.userId || s.silverUserId === input.userId,
      )
      .sort((a, b) => {
        const dt = b.createdAt.getTime() - a.createdAt.getTime();
        if (dt !== 0) return dt;
        return a.id.localeCompare(b.id);
      });

    const startIndex =
      input.cursor === null ? 0 : findCursorIndex(all, input.cursor);
    const limit = Math.max(1, Math.min(100, input.limit));
    const page = all.slice(startIndex, startIndex + limit);
    const nextStart = startIndex + page.length;
    const last = page[page.length - 1];
    const nextCursor =
      nextStart < all.length && last !== undefined
        ? encodeCursor(last.createdAt, last.id)
        : null;
    return { sessions: page, nextCursor };
  }
}

/**
 * Cursor encoding for the session list. The cursor identifies the row
 * that was *last* returned on the previous page, so the next page
 * starts at the immediately following row.
 */
function encodeCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}|${id}`;
}

function findCursorIndex(rows: SessionRecord[], cursor: string): number {
  for (let i = 0; i < rows.length; i++) {
    if (encodeCursor(rows[i].createdAt, rows[i].id) === cursor) {
      return i + 1;
    }
  }
  // Unknown cursor: behave as start. We do not throw because this is
  // a transient client/server skew condition, not a bug.
  return 0;
}

/* ===================================================================== */
/* User store                                                             */
/* ===================================================================== */

export class InMemoryUserStore implements UserStore {
  private readonly users = new Map<string, UserRecord>();

  async createUser(input: {
    readonly username: string;
    readonly passwordHash: string;
    readonly emailAddress: string;
  }): Promise<UserRecord> {
    // Uniqueness is checked case-insensitively, mirroring the postgres
    // `lower()`-based unique index used in production.
    const lcUsername = input.username.toLowerCase();
    const lcEmail = input.emailAddress.toLowerCase();
    for (const u of this.users.values()) {
      if (u.username.toLowerCase() === lcUsername) {
        throw new UserUniquenessError("username");
      }
      if (u.emailAddress.toLowerCase() === lcEmail) {
        throw new UserUniquenessError("email");
      }
    }
    const record: UserRecord = {
      id: randomUUID(),
      username: input.username,
      passwordHash: input.passwordHash,
      emailAddress: input.emailAddress,
      rCreated: new Date(),
      lastLogin: null,
      isActivated: false,
      isDisabled: false,
    };
    this.users.set(record.id, record);
    return record;
  }

  async getById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const lc = username.toLowerCase();
    for (const u of this.users.values()) {
      if (u.username.toLowerCase() === lc) return u;
    }
    return null;
  }

  async findByEmail(emailAddress: string): Promise<UserRecord | null> {
    const lc = emailAddress.toLowerCase();
    for (const u of this.users.values()) {
      if (u.emailAddress.toLowerCase() === lc) return u;
    }
    return null;
  }

  async setActivated(userId: string, isActivated: boolean): Promise<void> {
    const u = this.users.get(userId);
    if (u === undefined) return;
    this.users.set(userId, { ...u, isActivated });
  }

  async setDisabled(userId: string, isDisabled: boolean): Promise<void> {
    const u = this.users.get(userId);
    if (u === undefined) return;
    this.users.set(userId, { ...u, isDisabled });
  }

  async touchLastLogin(userId: string, now: Date): Promise<void> {
    const u = this.users.get(userId);
    if (u === undefined) return;
    this.users.set(userId, { ...u, lastLogin: now });
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    const u = this.users.get(userId);
    if (u === undefined) return;
    this.users.set(userId, { ...u, passwordHash });
  }

  async deleteUser(userId: string): Promise<void> {
    this.users.delete(userId);
  }
}

/* ===================================================================== */
/* Refresh-token store                                                    */
/* ===================================================================== */

export class InMemoryRefreshTokenStore implements RefreshTokenStore {
  private readonly tokens = new Map<string, RefreshTokenRecord>();

  async insert(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<RefreshTokenRecord> {
    const record: RefreshTokenRecord = {
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      rCreated: new Date(),
      expiresAt: input.expiresAt,
      revokedAt: null,
    };
    this.tokens.set(record.id, record);
    return record;
  }

  async findActiveByHash(
    tokenHash: string,
    now: Date,
  ): Promise<RefreshTokenRecord | null> {
    for (const t of this.tokens.values()) {
      if (t.tokenHash !== tokenHash) continue;
      if (t.revokedAt !== null) return null;
      if (t.expiresAt.getTime() <= now.getTime()) return null;
      return t;
    }
    return null;
  }

  async revoke(id: string, now: Date): Promise<void> {
    const t = this.tokens.get(id);
    if (t === undefined) return;
    if (t.revokedAt !== null) return;
    this.tokens.set(id, { ...t, revokedAt: now });
  }

  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    for (const [id, t] of this.tokens) {
      if (t.userId === userId && t.revokedAt === null) {
        this.tokens.set(id, { ...t, revokedAt: now });
      }
    }
  }
}

/* ===================================================================== */
/* Email-verification token store                                         */
/* ===================================================================== */

export class InMemoryEmailVerificationTokenStore
  implements EmailVerificationTokenStore
{
  private readonly tokens = new Map<string, EmailVerificationTokenRecord>();

  async insert(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<EmailVerificationTokenRecord> {
    const record: EmailVerificationTokenRecord = {
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      rCreated: new Date(),
      expiresAt: input.expiresAt,
    };
    this.tokens.set(record.id, record);
    return record;
  }

  async consumeByHash(
    tokenHash: string,
    now: Date,
  ): Promise<EmailVerificationTokenRecord | null> {
    for (const [id, t] of this.tokens) {
      if (t.tokenHash !== tokenHash) continue;
      this.tokens.delete(id);
      if (t.expiresAt.getTime() <= now.getTime()) return null;
      return t;
    }
    return null;
  }

  async deleteAllForUser(userId: string): Promise<void> {
    for (const [id, t] of this.tokens) {
      if (t.userId === userId) this.tokens.delete(id);
    }
  }
}

/* ===================================================================== */
/* Password-reset token store                                             */
/* ===================================================================== */

export class InMemoryPasswordResetTokenStore
  implements PasswordResetTokenStore
{
  private readonly tokens = new Map<string, PasswordResetTokenRecord>();

  async insert(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<PasswordResetTokenRecord> {
    const record: PasswordResetTokenRecord = {
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      rCreated: new Date(),
      expiresAt: input.expiresAt,
    };
    this.tokens.set(record.id, record);
    return record;
  }

  async consumeByHash(
    tokenHash: string,
    now: Date,
  ): Promise<PasswordResetTokenRecord | null> {
    for (const [id, t] of this.tokens) {
      if (t.tokenHash !== tokenHash) continue;
      this.tokens.delete(id);
      if (t.expiresAt.getTime() <= now.getTime()) return null;
      return t;
    }
    return null;
  }

  async deleteAllForUser(userId: string): Promise<void> {
    for (const [id, t] of this.tokens) {
      if (t.userId === userId) this.tokens.delete(id);
    }
  }
}

/* ===================================================================== */
/* Composite                                                              */
/* ===================================================================== */

/**
 * Convenience builder for tests: returns a `DataStore` whose component
 * stores are all in-memory.
 *
 * The composite also models the foreign-key cascade behaviour the
 * Postgres schema declares — without this wiring the test fakes would
 * diverge from production semantics on account deletion. Specifically:
 *
 *   - `users.deleteUser` cascades to refresh / verification / reset
 *     tokens (mirrors the `ON DELETE CASCADE` constraints).
 *   - `users.deleteUser` nulls out the gold/silver FKs on sessions
 *     (mirrors the `ON DELETE SET NULL` constraint).
 *
 * The Postgres implementation gets this for free from the database
 * itself; here we wrap the user store with a deleter that performs
 * the equivalent updates explicitly.
 */
export function buildInMemoryDataStore(): DataStore {
  const sessionsStore = new InMemorySessionStore();
  const baseUsers = new InMemoryUserStore();
  const refreshTokensStore = new InMemoryRefreshTokenStore();
  const emailTokensStore = new InMemoryEmailVerificationTokenStore();
  const resetTokensStore = new InMemoryPasswordResetTokenStore();

  // Wrap the user store so `deleteUser` performs the cascades. We
  // expose every other method untouched.
  const usersWithCascade: UserStore = {
    createUser: (input) => baseUsers.createUser(input),
    getById: (id) => baseUsers.getById(id),
    findByUsername: (u) => baseUsers.findByUsername(u),
    findByEmail: (e) => baseUsers.findByEmail(e),
    setActivated: (id, v) => baseUsers.setActivated(id, v),
    setDisabled: (id, v) => baseUsers.setDisabled(id, v),
    touchLastLogin: (id, n) => baseUsers.touchLastLogin(id, n),
    updatePasswordHash: (id, h) => baseUsers.updatePasswordHash(id, h),
    deleteUser: async (userId) => {
      // Cascade: drop tokens, then null out session FKs, then drop the
      // user row itself. The order does not matter for correctness in
      // an in-memory store, but mirroring the SQL order keeps the
      // mental model consistent.
      const now = new Date();
      await refreshTokensStore.revokeAllForUser(userId, now);
      await emailTokensStore.deleteAllForUser(userId);
      await resetTokensStore.deleteAllForUser(userId);
      // We need to reach inside the session store to null the FKs.
      // The sessions are stored in a private map; we expose a small
      // helper for cascade purposes here.
      sessionStoreClearUserFks(sessionsStore, userId);
      await baseUsers.deleteUser(userId);
    },
  };

  return {
    sessions: sessionsStore,
    users: usersWithCascade,
    refreshTokens: refreshTokensStore,
    emailVerificationTokens: emailTokensStore,
    passwordResetTokens: resetTokensStore,
  };
}

/**
 * Internal helper: walk the in-memory session store and null out any
 * gold/silver FK matching the deleted user. Lives here (rather than
 * as a method on `InMemorySessionStore`) so it does not become part of
 * the abstract interface — the production Postgres store delegates
 * this to the database via the FK constraint.
 */
function sessionStoreClearUserFks(
  store: InMemorySessionStore,
  userId: string,
): void {
  const map = (store as unknown as { sessions: Map<string, SessionRecord> })
    .sessions;
  for (const [id, record] of map) {
    if (record.goldUserId === userId || record.silverUserId === userId) {
      map.set(id, {
        ...record,
        goldUserId: record.goldUserId === userId ? null : record.goldUserId,
        silverUserId:
          record.silverUserId === userId ? null : record.silverUserId,
      });
    }
  }
}
