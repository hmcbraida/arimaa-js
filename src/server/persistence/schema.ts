/**
 * Drizzle ORM schema for the Arimaatic database.
 *
 * This file is the single source of truth for the table layout. The
 * Drizzle Kit migration generator reads this schema, diffs it against
 * the current migration history, and produces the SQL we ship in
 * `src/server/migrations/`.
 *
 * The schema covers two related concerns:
 *
 * 1. **Identity** (`users` and the three short-lived token tables)
 *    backs the username/password login flow, refresh-token issuance,
 *    email verification, and password reset.
 *
 * 2. **Game sessions** (`sessions`) records each Arimaa game; the
 *    creator and joiner are now identified by their user id rather than
 *    by an opaque per-session secret token.
 *
 * Where possible columns are non-nullable and decorated with explicit
 * default expressions so that "the database is always consistent" is a
 * structural guarantee rather than a runtime convention.
 */

import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* --------------------------------------------------------------------- */
/* Enums                                                                 */
/* --------------------------------------------------------------------- */

/**
 * Which side a still-active accept token will be redeemed onto. The
 * value is the *opposite* of the creator's chosen side. A Postgres enum
 * (rather than a free-text column) makes invalid values impossible to
 * write.
 */
export const sessionSideEnum = pgEnum("session_side", ["gold", "silver"]);

/* --------------------------------------------------------------------- */
/* Users                                                                 */
/* --------------------------------------------------------------------- */

/**
 * Canonical user record.
 *
 * Several of the column names follow a convention chosen by the product
 * spec (e.g. `rCreated` for "record created at"). They map onto
 * snake-case Postgres columns via Drizzle's column name argument, so
 * the on-disk shape stays idiomatic while the in-app shape stays
 * consistent with the rest of the codebase.
 *
 * Note that we never write `rCreated` from the application layer --  the
 * server-side `defaultNow()` is the only writer. This keeps the row's
 * creation time honest even if a route handler is ever buggy or
 * malicious about clocks.
 */
export const users = pgTable(
  "users",
  {
    /** Stable, non-reusable user identifier. */
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * Display name and login handle. Defaults to the email at signup
     * time if the caller passes a blank value, so the column itself is
     * non-nullable here.
     */
    username: text("username").notNull(),

    /**
     * Argon2id hash produced via `Bun.password.hash` with the default
     * cost parameters; never the plaintext.
     */
    passwordHash: text("password_hash").notNull(),

    /** Lowercased contact email. Used for verification & password reset. */
    emailAddress: text("email_address").notNull(),

    /**
     * Account creation timestamp. Server-side default; the application
     * layer never writes this column.
     */
    rCreated: timestamp("r_created", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /**
     * Last successful login (refresh-token redemption). Nullable because
     * a freshly created user has not "logged in" yet --  the registration
     * flow issues their first refresh token directly.
     */
    lastLogin: timestamp("last_login", { withTimezone: true }),

    /**
     * `true` once the user has clicked the link in their verification
     * email. Until then they receive a refresh token but cannot exchange
     * it for an access token.
     */
    isActivated: boolean("is_activated").notNull().default(false),

    /**
     * `true` if an admin has disabled the account. Same effect as
     * `isActivated=false` for the access-token redemption check, but
     * the public-facing reason code is different so the frontend can
     * show a distinct message.
     */
    isDisabled: boolean("is_disabled").notNull().default(false),
  },
  // Drizzle exposes case-insensitive unique constraints by lowering at
  // insert time; we keep the index strict here and rely on the route
  // layer to canonicalise inputs before passing them in.
  (table) => [
    uniqueIndex("users_username_unique").on(table.username),
    uniqueIndex("users_email_unique").on(table.emailAddress),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

/* --------------------------------------------------------------------- */
/* Refresh tokens                                                        */
/* --------------------------------------------------------------------- */

/**
 * Long-lived (1 year) opaque tokens that authenticate a user to the
 * `/auth/login-sessions/current/refresh-tokens` endpoint to obtain
 * short-lived access tokens.
 *
 * We store only a SHA-256 hash. The plaintext is shown to the caller
 * exactly once at issue time; the browser keeps it in localStorage.
 *
 * The table doubles as the revocation list: deleting a row immediately
 * invalidates the token, which is what makes "log out everywhere" and
 * "invalidate all sessions on password reset" simple to implement.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Owning user. `ON DELETE CASCADE` is appropriate because a deleted
     * account should also drop all its outstanding tokens.
     */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 hash of the opaque random token; never the plaintext. */
    tokenHash: text("token_hash").notNull(),
    /** Issue timestamp; server-side default. */
    rCreated: timestamp("r_created", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Hard expiry. Tokens past their `expiresAt` are rejected on use. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /**
     * Set once the token is revoked (either by an explicit logout, by
     * password change, or by account deletion). We keep the row around
     * for audit; the lookup query filters out revoked rows.
     */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  // The exchange endpoint looks tokens up by hash, so this is the
  // lookup key. Unique because a hash collision would imply that
  // separate `randomBytes(32)` calls produced the same output, which
  // we treat as impossible.
  (table) => [
    uniqueIndex("refresh_tokens_token_hash_unique").on(table.tokenHash),
    index("refresh_tokens_user_id_idx").on(table.userId),
  ],
);

export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type NewRefreshTokenRow = typeof refreshTokens.$inferInsert;

/* --------------------------------------------------------------------- */
/* Email-verification tokens                                             */
/* --------------------------------------------------------------------- */

/**
 * Short-lived (24 h) tokens emailed to a user when they request that
 * their address be verified. Hashed at rest, single-use, deleted on
 * redemption.
 */
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    rCreated: timestamp("r_created", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("email_verification_tokens_token_hash_unique").on(
      table.tokenHash,
    ),
    index("email_verification_tokens_user_id_idx").on(table.userId),
  ],
);

export type EmailVerificationTokenRow =
  typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationTokenRow =
  typeof emailVerificationTokens.$inferInsert;

/* --------------------------------------------------------------------- */
/* Password-reset tokens                                                 */
/* --------------------------------------------------------------------- */

/**
 * Short-lived (24 h) tokens emailed to a user who requested a password
 * reset. Hashed at rest, single-use, deleted on redemption. Successful
 * use also revokes all refresh tokens so a stolen-cookie attacker
 * cannot keep using their old session after the password rotates.
 */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    rCreated: timestamp("r_created", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_token_hash_unique").on(table.tokenHash),
    index("password_reset_tokens_user_id_idx").on(table.userId),
  ],
);

export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetTokenRow = typeof passwordResetTokens.$inferInsert;

/* --------------------------------------------------------------------- */
/* Game sessions                                                         */
/* --------------------------------------------------------------------- */

/**
 * Game session record.
 *
 * The schema previously authenticated each player against an opaque
 * per-session secret token. Now that real user accounts exist, the
 * authoritative ownership claim is the player's user id; the session
 * route layer authenticates the API caller via JWT and compares the
 * user id from the token against these columns.
 *
 * `gold_user_id` and `silver_user_id` are nullable because (a) at
 * creation time only one side has joined, and (b) `ON DELETE SET NULL`
 * preserves game history when an account is deleted.
 */
export const sessions = pgTable("sessions", {
  /** Stable, unguessable session identifier. */
  id: uuid("id").primaryKey(),

  /** Engine transcript representing the full game from setup onward. */
  transcript: text("transcript").notNull(),

  /** User id of the gold player, once one is associated. */
  goldUserId: uuid("gold_user_id").references(() => users.id, {
    onDelete: "set null",
  }),

  /** User id of the silver player, once one is associated. */
  silverUserId: uuid("silver_user_id").references(() => users.id, {
    onDelete: "set null",
  }),

  /**
   * The eight-digit accept code shared with the invitee. Cleared the
   * moment the code is redeemed -- that is how we encode "single-use"
   * without scheduling a cleanup job.
   *
   * Stored as plaintext rather than a hash. The consequence of a
   * leaked accept code is that an attacker could join a game
   * invitation meant for someone else -- annoying for that user, but
   * not a security breach. Hashing is reserved for secrets whose
   * exposure would cause real harm (passwords, refresh tokens, etc.).
   */
  acceptToken: text("accept_token"),

  /**
   * Which side the accept token will install when redeemed. Always the
   * opposite of the creator's chosen side. Cleared together with
   * `acceptToken`.
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
