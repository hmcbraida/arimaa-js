/**
 * Postgres-backed implementations of the persistence interfaces.
 *
 * Each store is its own class. They share a single Drizzle DB handle
 * which is constructed once at server startup. Methods here are
 * deliberately written to mirror the shape of the abstract interface
 * rather than the shape of the database — this keeps the routes
 * decoupled from the query layer.
 */

import { and, desc, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Side } from "../../game";
import {
  emailVerificationTokens,
  passwordResetTokens,
  refreshTokens,
  sessions,
  users,
} from "./schema";
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

/* --------------------------------------------------------------------- */
/* Row → Record converters                                                */
/* --------------------------------------------------------------------- */

/**
 * Drizzle returns the Postgres enum value as a literal string. Convert
 * once here so the rest of the server can deal in `Side`.
 */
function pendingSideFromRow(value: "gold" | "silver" | null): Side | null {
  if (value === null) return null;
  return value === "gold" ? Side.Gold : Side.Silver;
}

function sessionRowToRecord(row: {
  id: string;
  transcript: string;
  goldUserId: string | null;
  silverUserId: string | null;
  acceptTokenHash: string | null;
  pendingSide: "gold" | "silver" | null;
  createdAt: Date;
  updatedAt: Date;
}): SessionRecord {
  return {
    id: row.id,
    transcript: row.transcript,
    goldUserId: row.goldUserId,
    silverUserId: row.silverUserId,
    acceptTokenHash: row.acceptTokenHash,
    pendingSide: pendingSideFromRow(row.pendingSide),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function userRowToRecord(row: {
  id: string;
  username: string;
  passwordHash: string;
  emailAddress: string;
  rCreated: Date;
  lastLogin: Date | null;
  isActivated: boolean;
  isDisabled: boolean;
}): UserRecord {
  return { ...row };
}

/* --------------------------------------------------------------------- */
/* Cursor encoding for the user-session list                              */
/* --------------------------------------------------------------------- */

/**
 * The session list is keyset-paginated over `(created_at desc, id asc)`.
 * The cursor encodes the last row of the previous page; the next page
 * begins at the first row strictly older-than-or-equal-but-id-after.
 *
 * Encoding format: `<isoTimestamp>|<sessionId>`. The format is opaque
 * to clients; if we ever want to change it we just bump the format and
 * server-rewrite, and the client passes whatever they last received.
 */
function encodeCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}|${id}`;
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const idx = cursor.indexOf("|");
  if (idx <= 0) return null;
  const ts = cursor.slice(0, idx);
  const id = cursor.slice(idx + 1);
  const date = new Date(ts);
  if (Number.isNaN(date.getTime()) || id.length === 0) return null;
  return { createdAt: date, id };
}

/* --------------------------------------------------------------------- */
/* Session store                                                          */
/* --------------------------------------------------------------------- */

export class PostgresSessionStore implements SessionStore {
  public constructor(private readonly db: NodePgDatabase) {}

  async createSession(input: {
    readonly id: string;
    readonly side: Side;
    readonly creatorUserId: string;
    readonly acceptTokenHash: string;
    readonly transcript: string;
    readonly now: Date;
  }): Promise<SessionRecord> {
    const [row] = await this.db
      .insert(sessions)
      .values({
        id: input.id,
        transcript: input.transcript,
        goldUserId: input.side === Side.Gold ? input.creatorUserId : null,
        silverUserId: input.side === Side.Silver ? input.creatorUserId : null,
        acceptTokenHash: input.acceptTokenHash,
        pendingSide: input.side === Side.Gold ? "silver" : "gold",
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();
    return sessionRowToRecord(row);
  }

  async getById(id: string): Promise<SessionRecord | null> {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    return row === undefined ? null : sessionRowToRecord(row);
  }

  async consumeAcceptToken(input: {
    readonly acceptTokenHash: string;
    readonly write: SessionAcceptWrite;
    readonly now: Date;
  }): Promise<SessionRecord | null> {
    /**
     * Single-statement update. The `WHERE accept_token_hash IS NOT NULL`
     * predicate is the one that prevents a second redemption — once
     * the column is null no rows match, so two concurrent redemptions
     * race for one successful UPDATE.
     */
    const updated = await this.db
      .update(sessions)
      .set({
        goldUserId: sql`CASE WHEN ${sessions.pendingSide} = 'gold' THEN ${input.write.userId}::uuid ELSE ${sessions.goldUserId} END`,
        silverUserId: sql`CASE WHEN ${sessions.pendingSide} = 'silver' THEN ${input.write.userId}::uuid ELSE ${sessions.silverUserId} END`,
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
    return updated[0] === undefined ? null : sessionRowToRecord(updated[0]);
  }

  async findUserSide(
    sessionId: string,
    userId: string,
  ): Promise<{ session: SessionRecord; side: Side } | null> {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (row === undefined) return null;
    if (row.goldUserId === userId) {
      return { session: sessionRowToRecord(row), side: Side.Gold };
    }
    if (row.silverUserId === userId) {
      return { session: sessionRowToRecord(row), side: Side.Silver };
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
    return sessionRowToRecord(row);
  }

  async listForUser(input: {
    readonly userId: string;
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<SessionListPage> {
    const limit = Math.max(1, Math.min(100, input.limit));
    const ownsClause = or(
      eq(sessions.goldUserId, input.userId),
      eq(sessions.silverUserId, input.userId),
    );

    /**
     * Keyset filter. We want the rows that come strictly *after* the
     * cursor row in `(created_at desc, id asc)` order, which means:
     *
     *   created_at < cursor.createdAt
     *   OR (created_at = cursor.createdAt AND id > cursor.id)
     *
     * Drizzle's `lt` and `lte` operators map to SQL `<` and `<=` on
     * timestamps; the inner OR-chain handles the equal-timestamp tie
     * break.
     */
    const cursor = input.cursor === null ? null : decodeCursor(input.cursor);
    const where =
      cursor === null
        ? ownsClause
        : and(
            ownsClause,
            or(
              lt(sessions.createdAt, cursor.createdAt),
              and(
                eq(sessions.createdAt, cursor.createdAt),
                sql`${sessions.id} > ${cursor.id}::uuid`,
              ),
            ),
          );

    const rows = await this.db
      .select()
      .from(sessions)
      .where(where)
      .orderBy(desc(sessions.createdAt), sessions.id)
      .limit(limit + 1);

    const slice = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = slice[slice.length - 1];
    const nextCursor =
      hasMore && last !== undefined
        ? encodeCursor(last.createdAt, last.id)
        : null;
    return { sessions: slice.map(sessionRowToRecord), nextCursor };
  }
}

/* --------------------------------------------------------------------- */
/* User store                                                             */
/* --------------------------------------------------------------------- */

/**
 * Postgres unique-constraint violation code. We catch this specifically
 * to map collisions to the structured `UserUniquenessError` rather
 * than letting a raw driver error escape.
 */
const PG_UNIQUE_VIOLATION = "23505";

export class PostgresUserStore implements UserStore {
  public constructor(private readonly db: NodePgDatabase) {}

  async createUser(input: {
    readonly username: string;
    readonly passwordHash: string;
    readonly emailAddress: string;
  }): Promise<UserRecord> {
    try {
      const [row] = await this.db
        .insert(users)
        .values({
          username: input.username,
          passwordHash: input.passwordHash,
          emailAddress: input.emailAddress,
        })
        .returning();
      return userRowToRecord(row);
    } catch (err) {
      // We inspect the driver-supplied constraint name to decide which
      // field collided. Both unique indexes are named explicitly in the
      // schema so the strings here are stable.
      const e = err as { code?: string; constraint?: string };
      if (e.code === PG_UNIQUE_VIOLATION) {
        if (e.constraint === "users_username_unique") {
          throw new UserUniquenessError("username");
        }
        if (e.constraint === "users_email_unique") {
          throw new UserUniquenessError("email");
        }
      }
      throw err;
    }
  }

  async getById(id: string): Promise<UserRecord | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row === undefined ? null : userRowToRecord(row);
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    // We compare case-insensitively in SQL so the query plan can use
    // a functional index on `lower(username)` if one is added later.
    const [row] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = lower(${username})`)
      .limit(1);
    return row === undefined ? null : userRowToRecord(row);
  }

  async findByEmail(emailAddress: string): Promise<UserRecord | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.emailAddress}) = lower(${emailAddress})`)
      .limit(1);
    return row === undefined ? null : userRowToRecord(row);
  }

  async setActivated(userId: string, isActivated: boolean): Promise<void> {
    await this.db
      .update(users)
      .set({ isActivated })
      .where(eq(users.id, userId));
  }

  async setDisabled(userId: string, isDisabled: boolean): Promise<void> {
    await this.db.update(users).set({ isDisabled }).where(eq(users.id, userId));
  }

  async touchLastLogin(userId: string, now: Date): Promise<void> {
    await this.db
      .update(users)
      .set({ lastLogin: now })
      .where(eq(users.id, userId));
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, userId));
  }

  async deleteUser(userId: string): Promise<void> {
    await this.db.delete(users).where(eq(users.id, userId));
  }
}

/* --------------------------------------------------------------------- */
/* Refresh-token store                                                    */
/* --------------------------------------------------------------------- */

export class PostgresRefreshTokenStore implements RefreshTokenStore {
  public constructor(private readonly db: NodePgDatabase) {}

  async insert(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<RefreshTokenRecord> {
    const [row] = await this.db
      .insert(refreshTokens)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      })
      .returning();
    return row;
  }

  async findActiveByHash(
    tokenHash: string,
    now: Date,
  ): Promise<RefreshTokenRecord | null> {
    // Filter active rows in SQL so we never accidentally treat a
    // revoked or expired token as valid.
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          sql`${refreshTokens.revokedAt} IS NULL`,
          sql`${refreshTokens.expiresAt} > ${now}`,
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async revoke(id: string, now: Date): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(eq(refreshTokens.id, id), sql`${refreshTokens.revokedAt} IS NULL`),
      );
  }

  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          sql`${refreshTokens.revokedAt} IS NULL`,
        ),
      );
  }
}

/* --------------------------------------------------------------------- */
/* Email-verification token store                                         */
/* --------------------------------------------------------------------- */

export class PostgresEmailVerificationTokenStore
  implements EmailVerificationTokenStore
{
  public constructor(private readonly db: NodePgDatabase) {}

  async insert(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<EmailVerificationTokenRecord> {
    const [row] = await this.db
      .insert(emailVerificationTokens)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      })
      .returning();
    return row;
  }

  async consumeByHash(
    tokenHash: string,
    now: Date,
  ): Promise<EmailVerificationTokenRecord | null> {
    /**
     * `DELETE ... RETURNING` makes consumption atomic in one statement:
     * the row is gone before the function returns. If the row has
     * already expired we still delete it (cleanup) but report failure.
     */
    const deleted = await this.db
      .delete(emailVerificationTokens)
      .where(eq(emailVerificationTokens.tokenHash, tokenHash))
      .returning();
    const row = deleted[0];
    if (row === undefined) return null;
    if (row.expiresAt.getTime() <= now.getTime()) return null;
    return row;
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.db
      .delete(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, userId));
  }
}

/* --------------------------------------------------------------------- */
/* Password-reset token store                                             */
/* --------------------------------------------------------------------- */

export class PostgresPasswordResetTokenStore
  implements PasswordResetTokenStore
{
  public constructor(private readonly db: NodePgDatabase) {}

  async insert(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<PasswordResetTokenRecord> {
    const [row] = await this.db
      .insert(passwordResetTokens)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      })
      .returning();
    return row;
  }

  async consumeByHash(
    tokenHash: string,
    now: Date,
  ): Promise<PasswordResetTokenRecord | null> {
    const deleted = await this.db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .returning();
    const row = deleted[0];
    if (row === undefined) return null;
    if (row.expiresAt.getTime() <= now.getTime()) return null;
    return row;
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, userId));
  }
}

/* --------------------------------------------------------------------- */
/* Composite                                                              */
/* --------------------------------------------------------------------- */

/**
 * Bundle helper for the production composition root. Builds a
 * `DataStore` whose components share a single Drizzle handle.
 */
export function buildPostgresDataStore(db: NodePgDatabase): DataStore {
  return {
    sessions: new PostgresSessionStore(db),
    users: new PostgresUserStore(db),
    refreshTokens: new PostgresRefreshTokenStore(db),
    emailVerificationTokens: new PostgresEmailVerificationTokenStore(db),
    passwordResetTokens: new PostgresPasswordResetTokenStore(db),
  };
}
