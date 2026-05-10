/**
 * Shared refresh-token cookie helpers used by the auth and user routes.
 *
 * Both `auth.ts` (login) and `users.ts` (register) issue the `rt`
 * cookie; keeping the name and options in one place ensures they are
 * always consistent.
 */

/** Name of the httpOnly cookie that carries the long-lived refresh token. */
export const RT_COOKIE = "rt";

/**
 * Cookie options shared by every Set-Cookie call that writes the
 * refresh token. The `expires` field is set per-call since it is
 * token-specific.
 */
export function rtCookieOptions(secureCookies: boolean, expiresAt: Date) {
  return {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
