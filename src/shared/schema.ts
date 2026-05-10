/**
 * Shared API contract for the Arimaatic networked-play API.
 *
 * Both the Fastify server and the browser-side network client import
 * the same zod schemas from this module so the wire format has exactly
 * one definition. The server uses these schemas to validate incoming
 * bodies and to serialise outgoing responses; the client uses them to
 * verify that server responses match the contract before handing data
 * to the UI layer.
 *
 * The file is organised into:
 *   - Primitive value schemas (sides, statuses, reasons, error codes)
 *   - Game session shapes (snapshot, move log, list page)
 *   - Game session HTTP request / response shapes
 *   - User account / authentication shapes
 *   - Email verification shapes
 *   - Password reset shapes
 *   - WebSocket event shapes
 *
 * Keeping the schemas in `src/shared` (rather than under `src/server`)
 * is intentional: the contract is part of the public surface of the
 * application, not an implementation detail of the backend.
 */

import { z } from "zod";

/* --------------------------------------------------------------------- */
/* Primitive value schemas                                               */
/* --------------------------------------------------------------------- */

export const sideSchema = z.enum(["gold", "silver"]);
export type Side = z.infer<typeof sideSchema>;

export const sessionStatusSchema = z.enum([
  "waiting",
  "gold",
  "silver",
  "completed",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const gameOutcomeReasonSchema = z.enum([
  "goal",
  "rabbit-loss",
  "immobilized",
  "repetition",
]);
export type GameOutcomeReason = z.infer<typeof gameOutcomeReasonSchema>;

/**
 * Refresh-token-redemption failure codes.
 *
 * The frontend uses these to decide which "stuck on login" screen to
 * show --  a not-yet-activated account triggers the resend-verification
 * widget; a disabled account renders an unappealable explanation.
 *
 * `invalid` is the catch-all for "the refresh token is no longer
 * usable for any reason"; we deliberately collapse the
 * expired/revoked/unknown cases so a holder of a stolen token cannot
 * distinguish them.
 */
export const refreshFailureReasonSchema = z.enum([
  "account-not-activated",
  "account-disabled",
  "invalid",
]);
export type RefreshFailureReason = z.infer<typeof refreshFailureReasonSchema>;

/* --------------------------------------------------------------------- */
/* Game session shapes                                                   */
/* --------------------------------------------------------------------- */

export const sessionMoveLogEntrySchema = z.object({
  moveNumber: z.number().int().nonnegative(),
  side: sideSchema,
  notation: z.string(),
});
export type SessionMoveLogEntry = z.infer<typeof sessionMoveLogEntrySchema>;

/**
 * Public participant info attached to session snapshots so the UI can
 * render whose game it is without making a second `GET /users/:id`
 * call. Only fields that are safe to expose (id, username) are
 * included.
 */
export const sessionParticipantSchema = z
  .object({
    userId: z.uuid(),
    username: z.string(),
  })
  .nullable();
export type SessionParticipant = z.infer<typeof sessionParticipantSchema>;

/**
 * The complete public view of a game session.
 *
 * The `participants` map carries the (userId, username) pairs for both
 * sides. Either side may be null while the second player has not yet
 * accepted the invitation, or after an account deletion that nulled
 * the FK. (Past games of a deleted user remain visible without an
 * owner for the relevant side.)
 */
export const sessionSnapshotSchema = z.object({
  id: z.uuid(),
  status: sessionStatusSchema,
  sideToMove: sideSchema.nullable(),
  transcript: z.string(),
  moveLog: z.array(sessionMoveLogEntrySchema),
  winner: sideSchema.nullable(),
  reason: gameOutcomeReasonSchema.nullable(),
  participants: z.object({
    gold: sessionParticipantSchema,
    silver: sessionParticipantSchema,
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;

/* --------------------------------------------------------------------- */
/* Game session HTTP request / response shapes                            */
/* --------------------------------------------------------------------- */

export const createSessionQuerySchema = z.object({
  side: sideSchema,
});
export type CreateSessionQuery = z.infer<typeof createSessionQuerySchema>;

/**
 * `POST /api/sessions` response.
 *
 * The session is now created on behalf of an authenticated user, so
 * the response no longer carries a per-side opaque secret token. The
 * eight-digit accept code (still single-use) is returned so the
 * creator can share it with the opponent.
 */
export const createSessionResponseSchema = z.object({
  sessionId: z.uuid(),
  side: sideSchema,
  acceptToken: z.string().regex(/^\d{8}$/),
  snapshot: sessionSnapshotSchema,
});
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;

export const acceptSessionRequestSchema = z.object({
  acceptToken: z.string().regex(/^\d{8}$/),
});
export type AcceptSessionRequest = z.infer<typeof acceptSessionRequestSchema>;

/**
 * `POST /api/session-accept` response.
 *
 * The joining player is authenticated with their access token, so the
 * response only needs to tell them which side they picked up and
 * include the latest snapshot.
 */
export const acceptSessionResponseSchema = z.object({
  sessionId: z.uuid(),
  side: sideSchema,
  snapshot: sessionSnapshotSchema,
});
export type AcceptSessionResponse = z.infer<typeof acceptSessionResponseSchema>;

export const submitMoveRequestSchema = z.object({
  moveNotation: z.string().min(1),
});
export type SubmitMoveRequest = z.infer<typeof submitMoveRequestSchema>;

export const submitMoveResponseSchema = z.object({
  snapshot: sessionSnapshotSchema,
});
export type SubmitMoveResponse = z.infer<typeof submitMoveResponseSchema>;

export const sessionIdParamsSchema = z.object({
  id: z.uuid(),
});
export type SessionIdParams = z.infer<typeof sessionIdParamsSchema>;

/**
 * `GET /api/sessions/:id` response -- exactly the public snapshot.
 */
export const getSessionResponseSchema = sessionSnapshotSchema;
export type GetSessionResponse = z.infer<typeof getSessionResponseSchema>;

/**
 * `GET /api/sessions/:id/accept-token` response.
 *
 * Only returned to authenticated participants. The token is null once
 * the opponent has joined (i.e. it has been redeemed).
 */
export const getSessionAcceptTokenResponseSchema = z.object({
  acceptToken: z
    .string()
    .regex(/^\d{8}$/)
    .nullable(),
});
export type GetSessionAcceptTokenResponse = z.infer<
  typeof getSessionAcceptTokenResponseSchema
>;

/* --------------------------------------------------------------------- */
/* User-scoped session list                                              */
/* --------------------------------------------------------------------- */

/**
 * One row of the authenticated user's game-list view. Smaller than
 * the full snapshot --  we drop the transcript and move log because the
 * list view does not need them. The frontend follows up with
 * `GET /api/sessions/:id` to load full data when the user opens a
 * specific game.
 */
export const sessionListEntrySchema = z.object({
  id: z.uuid(),
  status: sessionStatusSchema,
  sideToMove: sideSchema.nullable(),
  yourSide: sideSchema,
  /**
   * Whose turn it is from the requesting user's point of view. `you`
   * means the API caller; `opponent` means the other side; `null`
   * means the game is waiting for an opponent or already completed.
   */
  whoseTurn: z.enum(["you", "opponent"]).nullable(),
  participants: z.object({
    gold: sessionParticipantSchema,
    silver: sessionParticipantSchema,
  }),
  winner: sideSchema.nullable(),
  reason: gameOutcomeReasonSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SessionListEntry = z.infer<typeof sessionListEntrySchema>;

/** `GET /api/users/me/sessions` query string. */
export const listUserSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});
export type ListUserSessionsQuery = z.infer<typeof listUserSessionsQuerySchema>;

/** `GET /api/users/me/sessions` response. */
export const listUserSessionsResponseSchema = z.object({
  sessions: z.array(sessionListEntrySchema),
  nextCursor: z.string().nullable(),
});
export type ListUserSessionsResponse = z.infer<
  typeof listUserSessionsResponseSchema
>;

/* --------------------------------------------------------------------- */
/* User account shapes                                                   */
/* --------------------------------------------------------------------- */

/**
 * Username constraint. Letters, digits, dot, underscore, and hyphen.
 * The lower bound is two characters because a single character is too
 * easy to confuse for a typo of someone else's name.
 *
 * The upper bound (32) is generous; it just keeps the column out of
 * the toast region.
 */
export const usernameSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(
    /^[A-Za-z0-9._-]+$/,
    "Username may use letters, digits, '.', '_', and '-'",
  );

/**
 * Email validation. Zod's `.email()` is good enough for our purposes
 * --  we treat the address as opaque and rely on the verification email
 * round-trip to prove deliverability.
 */
export const emailSchema = z.email().max(254);

/**
 * Password constraint. Minimum 8 characters; we do not impose
 * complexity rules because they hurt usable strength more than they
 * help (NIST SP 800-63B). The 200-character upper bound prevents
 * someone hashing a megabyte and tying up a worker thread.
 */
export const passwordSchema = z.string().min(8).max(200);

/**
 * Profile shape for authenticated endpoints (`GET /users/me`, session
 * bundles, etc.). Includes `emailAddress` — do NOT embed this in any
 * publicly-visible API response; use a narrower schema there instead.
 */
export const protectedUserProfileSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  emailAddress: z.string(),
  rCreated: z.string(),
  lastLogin: z.string().nullable(),
  isActivated: z.boolean(),
  isDisabled: z.boolean(),
});
export type UserProfile = z.infer<typeof protectedUserProfileSchema>;

/* --------------------------------------------------------------------- */
/* Account creation                                                       */
/* --------------------------------------------------------------------- */

/**
 * `POST /api/users` body.
 */
export const createUserRequestSchema = z.object({
  username: usernameSchema,
  emailAddress: emailSchema,
  password: passwordSchema,
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

/** `PUT /api/users/me/password` body. */
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/**
 * The login / register / refresh endpoints all return the same
 * "session bundle": the JWT access token and the user's profile.
 * The refresh token is delivered separately as an httpOnly cookie
 * (`rt`) so it never touches JavaScript memory.
 */
export const sessionBundleSchema = z.object({
  accessToken: z.string(),
  /**
   * Expiry timestamp for the access token, ISO 8601. Lets the client
   * pre-emptively refresh the token rather than waiting for a 401.
   */
  accessTokenExpiresAt: z.string(),
  user: protectedUserProfileSchema,
});
export type SessionBundle = z.infer<typeof sessionBundleSchema>;

/**
 * `POST /api/users` response. Account creation is a successful login
 * even though the account is not yet activated, so the response is
 * the full session bundle. The refresh token is delivered as an
 * httpOnly cookie (`rt`) rather than in the body; only the access
 * token (which the frontend must include in every API request) is
 * returned here.
 *
 * Until activation the access token field is `null`. The frontend
 * detects this and routes the user to the login-pending screen.
 */
export const createUserResponseSchema = z.object({
  user: protectedUserProfileSchema,
  accessToken: z.string().nullable(),
  accessTokenExpiresAt: z.string().nullable(),
});
export type CreateUserResponse = z.infer<typeof createUserResponseSchema>;

/**
 * `DELETE /api/users/me` returns nothing useful; clients infer success
 * from the 204 status. We still declare a schema (an empty object) so
 * the type provider does not complain about a void body.
 */
export const emptyResponseSchema = z.object({}).strict();
export type EmptyResponse = z.infer<typeof emptyResponseSchema>;

/* --------------------------------------------------------------------- */
/* Login / refresh / logout                                              */
/* --------------------------------------------------------------------- */

/**
 * `POST /api/auth/login-sessions` body --  username-or-email plus
 * password. The server matches `usernameOrEmail` against both the
 * `username` and `emailAddress` columns so a returning user does not
 * need to remember which one they used.
 */
export const loginRequestSchema = z.object({
  usernameOrEmail: z.string().min(1),
  password: passwordSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * `POST /api/auth/login-sessions` response. Mirrors the
 * registration response (refresh token always issued; access token
 * may be null when the account cannot currently authorise requests).
 */
export const loginResponseSchema = createUserResponseSchema;
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/**
 * `POST /api/auth/login-sessions/current/refresh-tokens` has no request
 * body — the refresh token is read from the `rt` httpOnly cookie which
 * the browser sends automatically.
 */
export const refreshAccessTokenRequestSchema = z.object({}).strict();
export type RefreshAccessTokenRequest = z.infer<
  typeof refreshAccessTokenRequestSchema
>;

/**
 * Discriminated response for the access-token-exchange endpoint. The
 * happy path returns `{ ok: true, ... }`. The unhappy path returns
 * `{ ok: false, reason }` with a structured reason so the frontend
 * can route to the appropriate screen.
 */
export const refreshAccessTokenResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    accessToken: z.string(),
    accessTokenExpiresAt: z.string(),
    user: protectedUserProfileSchema,
  }),
  z.object({
    ok: z.literal(false),
    reason: refreshFailureReasonSchema,
    user: protectedUserProfileSchema.nullable(),
  }),
]);
export type RefreshAccessTokenResponse = z.infer<
  typeof refreshAccessTokenResponseSchema
>;

/**
 * `DELETE /api/auth/login-sessions/current` has no request body — the
 * refresh token to revoke is read from the `rt` httpOnly cookie.
 * Logout is idempotent.
 */
export const logoutRequestSchema = z.object({}).strict();
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;

/* --------------------------------------------------------------------- */
/* Email verification                                                    */
/* --------------------------------------------------------------------- */

/**
 * `POST /api/email-verifications/{token}` URL parameter.
 */
export const emailVerificationParamsSchema = z.object({
  token: z.string().min(1),
});
export type EmailVerificationParams = z.infer<
  typeof emailVerificationParamsSchema
>;

/**
 * `POST /api/users/me/email/verification` has no request body — like
 * the refresh endpoint, it authenticates via the `rt` httpOnly cookie.
 * An unactivated user has the cookie but cannot yet obtain an access
 * token, so the cookie is the only available proof of identity.
 */
export const resendVerificationRequestSchema = z.object({}).strict();
export type ResendVerificationRequest = z.infer<
  typeof resendVerificationRequestSchema
>;

/* --------------------------------------------------------------------- */
/* Password reset                                                        */
/* --------------------------------------------------------------------- */

/**
 * `POST /api/passwords/resets` body --  the email address to send a
 * reset link to. Always returns 204 even when no account matches; we
 * do not leak account existence.
 */
export const requestPasswordResetSchema = z.object({
  emailAddress: emailSchema,
});
export type RequestPasswordResetRequest = z.infer<
  typeof requestPasswordResetSchema
>;

/**
 * `POST /api/passwords/resets/{token}` body --  the chosen new password.
 */
export const completePasswordResetSchema = z.object({
  newPassword: passwordSchema,
});
export type CompletePasswordResetRequest = z.infer<
  typeof completePasswordResetSchema
>;

/**
 * `POST /api/passwords/resets/{token}` URL parameter.
 */
export const passwordResetTokenParamsSchema = z.object({
  token: z.string().min(1),
});
export type PasswordResetTokenParams = z.infer<
  typeof passwordResetTokenParamsSchema
>;

/* --------------------------------------------------------------------- */
/* Error envelope                                                        */
/* --------------------------------------------------------------------- */

export const errorResponseSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  /**
   * Optional structured error code so the frontend can branch on
   * specific failures (e.g. `username-taken`, `email-taken`,
   * `invalid-credentials`) without parsing the human-readable
   * message.
   */
  code: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/* --------------------------------------------------------------------- */
/* WebSocket events                                                      */
/* --------------------------------------------------------------------- */

export const sessionAcceptedEventSchema = z.object({
  type: z.literal("accepted"),
  sessionId: z.uuid(),
  snapshot: sessionSnapshotSchema,
});
export type SessionAcceptedEvent = z.infer<typeof sessionAcceptedEventSchema>;

export const sessionMoveEventSchema = z.object({
  type: z.literal("move"),
  sessionId: z.uuid(),
  move: sessionMoveLogEntrySchema,
  snapshot: sessionSnapshotSchema,
});
export type SessionMoveEvent = z.infer<typeof sessionMoveEventSchema>;

export const sessionCompletedEventSchema = z.object({
  type: z.literal("completed"),
  sessionId: z.uuid(),
  winner: sideSchema,
  reason: gameOutcomeReasonSchema,
  snapshot: sessionSnapshotSchema,
});
export type SessionCompletedEvent = z.infer<typeof sessionCompletedEventSchema>;

export const sessionEventSchema = z.discriminatedUnion("type", [
  sessionAcceptedEventSchema,
  sessionMoveEventSchema,
  sessionCompletedEventSchema,
]);
export type SessionEvent = z.infer<typeof sessionEventSchema>;
