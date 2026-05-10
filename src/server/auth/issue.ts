/**
 * Helpers for issuing refresh and access tokens to a user.
 *
 * The login, register, and refresh routes each need to perform the
 * same sequence of steps: generate a fresh refresh token, persist its
 * hash, attempt to mint an access token (subject to activation /
 * disabled checks), and return a `SessionBundle` to the client. We
 * keep the logic in one place so the rules cannot drift between
 * endpoints.
 */

import type { UserProfile } from "../../shared/schema";
import type { DataStore, UserRecord } from "../persistence/store";
import {
  ACCESS_TOKEN_TTL_MS,
  type AuthTokenSigner,
  REFRESH_TOKEN_TTL_MS,
  generateOpaqueToken,
  hashToken,
} from "./tokens";

/**
 * Translate a `UserRecord` into the public `UserProfile` shape the
 * client receives. We never expose `passwordHash` and we surface the
 * timestamps as ISO strings.
 */
export function userRecordToProfile(user: UserRecord): UserProfile {
  return {
    id: user.id,
    username: user.username,
    emailAddress: user.emailAddress,
    rCreated: user.rCreated.toISOString(),
    lastLogin: user.lastLogin === null ? null : user.lastLogin.toISOString(),
    isActivated: user.isActivated,
    isDisabled: user.isDisabled,
  };
}

/**
 * Generate a refresh token, persist its hash, and return both the
 * plaintext (returned to the client) and the row's expiry timestamp
 * (also returned to the client so it knows when the token dies).
 */
export async function issueRefreshToken(
  store: DataStore,
  user: UserRecord,
  now: Date,
): Promise<{ refreshToken: string; expiresAt: Date }> {
  const refreshToken = generateOpaqueToken();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
  await store.refreshTokens.insert({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt,
  });
  return { refreshToken, expiresAt };
}

/**
 * Try to mint an access token for the given user.
 *
 * Returns `null` if the user is not activated or is disabled -- the
 * caller turns that into a structured "stuck on login" payload for the
 * frontend. Otherwise returns the JWT plus its expiry, and updates
 * `lastLogin` because successful access-token issuance is what we
 * count as "logged in".
 */
export async function tryIssueAccessToken(
  store: DataStore,
  signer: AuthTokenSigner,
  user: UserRecord,
  now: Date,
): Promise<{ accessToken: string; expiresAt: Date } | null> {
  if (!user.isActivated) return null;
  if (user.isDisabled) return null;
  const accessToken = await signer.signAccessToken(user.id, now);
  const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
  await store.users.touchLastLogin(user.id, now);
  return { accessToken, expiresAt };
}
