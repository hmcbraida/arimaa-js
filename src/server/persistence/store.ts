/**
 * Persistence interfaces for the Arimaatic server.
 *
 * The route handlers depend only on these abstract interfaces, not on
 * any concrete database. Two implementations are shipped for each
 * store:
 *
 * - A Postgres implementation under `postgresStore.ts` for production.
 * - An in-memory implementation under `memoryStore.ts` for tests.
 *
 * Keeping the interface small and explicit (rather than letting the
 * routes touch a query builder directly) means we can grow new
 * persistence backends or storage strategies without auditing every
 * endpoint, and the test suite can run without external infrastructure.
 *
 * The file is organised by domain:
 *   - Game session records (this was the original surface)
 *   - User accounts
 *   - Refresh tokens
 *   - Email-verification tokens
 *   - Password-reset tokens
 *
 * Each store interface is independent. They are bundled into a single
 * `DataStore` object at the composition root so route handlers receive
 * one dependency rather than five.
 */

import type { Side } from "../../game";

/* ===================================================================== */
/* Game sessions                                                          */
/* ===================================================================== */

/**
 * The full row shape stored for a single game session.
 *
 * Note that under the user-account model the per-side authentication
 * column is the *user id* of the player on that side, not an opaque
 * token. The accept token (the eight-digit invite code) survives
 * because we still need a way for one player to invite another.
 *
 * Both `goldUserId` and `silverUserId` are nullable so the same row
 * shape can describe (a) the freshly-created session that is waiting
 * for an opponent and (b) a session whose former owner deleted their
 * account, in which case the FK is set to null but the game history
 * remains visible.
 */
export interface SessionRecord {
  readonly id: string;
  readonly transcript: string;
  readonly goldUserId: string | null;
  readonly silverUserId: string | null;
  readonly acceptTokenHash: string | null;
  /** Which side the still-active accept token will install when redeemed. */
  readonly pendingSide: Side | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Inputs the join flow needs to atomically install a user as the
 * opposite side from the creator.
 */
export interface SessionAcceptWrite {
  readonly userId: string;
}

/**
 * One page of the authenticated user's game list, plus a cursor that
 * the next request can pass back to continue scanning.
 */
export interface SessionListPage {
  readonly sessions: ReadonlyArray<SessionRecord>;
  /**
   * Opaque cursor to pass into the next call to advance pagination.
   * `null` means there are no further pages. We model this as opaque
   * to the caller so the cursor encoding can change without breaking
   * the API contract.
   */
  readonly nextCursor: string | null;
}

export interface SessionStore {
  /**
   * Insert a brand-new session row.
   *
   * The route layer generates the id and decides which side belongs to
   * the creator based on `?side=`. The accept token hash is the
   * SHA-256 of the eight-digit code shared with the invitee.
   */
  createSession(input: {
    readonly id: string;
    readonly side: Side;
    readonly creatorUserId: string;
    readonly acceptTokenHash: string;
    readonly transcript: string;
    readonly now: Date;
  }): Promise<SessionRecord>;

  /** Look up a session by id. Used by the public `GET` endpoint. */
  getById(id: string): Promise<SessionRecord | null>;

  /**
   * Atomically consume an accept token by hash and assign the joining
   * user to the appropriate side.
   *
   * Returns the updated record if the accept token matched and was
   * still active, or null otherwise. Implementations must guarantee
   * single-use semantics: two concurrent calls with the same accept
   * token must result in exactly one success.
   */
  consumeAcceptToken(input: {
    readonly acceptTokenHash: string;
    readonly write: SessionAcceptWrite;
    readonly now: Date;
  }): Promise<SessionRecord | null>;

  /**
   * Determine which side (if any) a given user is on within a given
   * session. Used by the move-submission route to validate the JWT
   * caller and pick the side they are allowed to move.
   */
  findUserSide(
    sessionId: string,
    userId: string,
  ): Promise<{ session: SessionRecord; side: Side } | null>;

  /** Persist a transcript update produced by a successful move. */
  updateTranscript(input: {
    readonly id: string;
    readonly transcript: string;
    readonly now: Date;
  }): Promise<SessionRecord>;

  /**
   * Return one page of the given user's sessions in descending
   * `createdAt` order. Used by the authenticated games-list view.
   *
   * `cursor` is the opaque continuation value returned by the previous
   * call, or `null` for the first page. `limit` is capped by the
   * implementation if it is unreasonably large.
   */
  listForUser(input: {
    readonly userId: string;
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<SessionListPage>;
}

/* ===================================================================== */
/* Users                                                                  */
/* ===================================================================== */

/**
 * The persisted shape of a user account.
 *
 * The `passwordHash` field is the only secret here; the rest is safe
 * to surface to the user themselves but never to other users.
 */
export interface UserRecord {
  readonly id: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly emailAddress: string;
  readonly rCreated: Date;
  readonly lastLogin: Date | null;
  readonly isActivated: boolean;
  readonly isDisabled: boolean;
}

/**
 * Errors raised when account creation collides with an existing row on
 * one of the unique columns. We surface a discriminator rather than
 * inspecting database error codes at the call site.
 */
export class UserUniquenessError extends Error {
  public readonly field: "username" | "email";
  public constructor(field: "username" | "email") {
    super(`User ${field} is already in use`);
    this.name = "UserUniquenessError";
    this.field = field;
  }
}

export interface UserStore {
  /**
   * Insert a new user. Throws `UserUniquenessError` if the username or
   * email collides with an existing row. The `passwordHash` must be the
   * argon2id digest produced by the auth layer; the store does not
   * hash anything itself.
   */
  createUser(input: {
    readonly username: string;
    readonly passwordHash: string;
    readonly emailAddress: string;
  }): Promise<UserRecord>;

  /** Look up a user by id. */
  getById(id: string): Promise<UserRecord | null>;

  /** Look up a user by case-insensitive username. */
  findByUsername(username: string): Promise<UserRecord | null>;

  /** Look up a user by case-insensitive email address. */
  findByEmail(emailAddress: string): Promise<UserRecord | null>;

  /** Mark the account as activated (post-email-verification). */
  setActivated(userId: string, isActivated: boolean): Promise<void>;

  /**
   * Mark the account as disabled. There is no public endpoint to call
   * this — it's reserved for future administrative tooling — but the
   * column is consulted on every refresh-token exchange so the auth
   * routes need a way to flip it. Tests use this to exercise the
   * "account-disabled" branch.
   */
  setDisabled(userId: string, isDisabled: boolean): Promise<void>;

  /**
   * Update the `lastLogin` timestamp on a successful access-token
   * issuance. Failed exchanges (disabled / unverified) do not call
   * this; "last login" only counts genuine successful authorisations.
   */
  touchLastLogin(userId: string, now: Date): Promise<void>;

  /** Replace the password hash. */
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;

  /**
   * Hard-delete the user. ON DELETE CASCADE on dependent tables means
   * refresh / verification / reset tokens disappear together; ON DELETE
   * SET NULL on the sessions FKs preserves game history with anonymous
   * ownership.
   */
  deleteUser(userId: string): Promise<void>;
}

/* ===================================================================== */
/* Refresh tokens                                                         */
/* ===================================================================== */

export interface RefreshTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly rCreated: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface RefreshTokenStore {
  /** Insert a freshly issued refresh token. */
  insert(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<RefreshTokenRecord>;

  /**
   * Look up a refresh token by its SHA-256 hash. Returns null when
   * there is no matching row OR when the token is expired / revoked;
   * collapsing those cases means callers cannot accidentally accept a
   * dead token.
   */
  findActiveByHash(
    tokenHash: string,
    now: Date,
  ): Promise<RefreshTokenRecord | null>;

  /** Revoke a single refresh token (idempotent). */
  revoke(id: string, now: Date): Promise<void>;

  /**
   * Revoke every refresh token for a user. Used when the user changes
   * their password or deletes their account.
   */
  revokeAllForUser(userId: string, now: Date): Promise<void>;
}

/* ===================================================================== */
/* Email-verification tokens                                              */
/* ===================================================================== */

export interface EmailVerificationTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly rCreated: Date;
  readonly expiresAt: Date;
}

export interface EmailVerificationTokenStore {
  /** Insert a fresh verification token row. */
  insert(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<EmailVerificationTokenRecord>;

  /**
   * Atomically consume a verification token. Returns the row if it
   * existed and was unexpired; returns null otherwise. Implementations
   * delete the row on consumption so re-use returns null.
   */
  consumeByHash(
    tokenHash: string,
    now: Date,
  ): Promise<EmailVerificationTokenRecord | null>;

  /**
   * Drop all outstanding verification tokens for a user. Used when a
   * fresh "resend verification email" call supersedes any prior tokens.
   */
  deleteAllForUser(userId: string): Promise<void>;
}

/* ===================================================================== */
/* Password-reset tokens                                                  */
/* ===================================================================== */

export interface PasswordResetTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly rCreated: Date;
  readonly expiresAt: Date;
}

export interface PasswordResetTokenStore {
  insert(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<PasswordResetTokenRecord>;

  /**
   * Atomically consume a reset token. Returns the row if it existed
   * and was unexpired; returns null otherwise. Implementations delete
   * the row on consumption so re-use returns null.
   */
  consumeByHash(
    tokenHash: string,
    now: Date,
  ): Promise<PasswordResetTokenRecord | null>;

  /** Drop all outstanding reset tokens for a user. */
  deleteAllForUser(userId: string): Promise<void>;
}

/* ===================================================================== */
/* Bundle                                                                 */
/* ===================================================================== */

/**
 * The set of stores the route layer expects. Composition roots build
 * one of these from concrete implementations and pass it to
 * `buildServer`. Tests typically build it from the in-memory
 * implementations.
 */
export interface DataStore {
  readonly sessions: SessionStore;
  readonly users: UserStore;
  readonly refreshTokens: RefreshTokenStore;
  readonly emailVerificationTokens: EmailVerificationTokenStore;
  readonly passwordResetTokens: PasswordResetTokenStore;
}
