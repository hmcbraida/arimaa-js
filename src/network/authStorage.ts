/**
 * AuthStorage — the only kind of state the browser persists between
 * sessions.
 *
 * The previous iteration of this module persisted a games list. That
 * list is now retrieved from the server via `GET /api/users/me/sessions`,
 * so the browser only needs to remember the credentials needed to ask
 * the server "who am I?" on a subsequent page load.
 *
 * Two concrete implementations live here:
 *
 *   - `LocalStorageAuthStorage` for production.
 *   - `MemoryAuthStorage` for component tests, where window.localStorage
 *     either does not exist (server-side test runners) or would leak
 *     between tests.
 */

import { z } from "zod";
import { userProfileSchema } from "../shared/schema";

/**
 * The shape of the persisted auth blob.
 *
 * - `refreshToken` is the long-lived opaque token issued at login or
 *   register time.
 * - `refreshTokenExpiresAt` is the ISO timestamp at which the server
 *   will refuse the token. The frontend can hide a clearly-dead token
 *   without round-tripping the server.
 * - `user` is the last-known profile; useful for rendering the navbar
 *   instantly on cold load while the access-token refresh is in flight.
 */
const persistedAuthSchema = z.object({
  version: z.literal(1),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.string(),
  user: userProfileSchema,
});

export type PersistedAuth = z.infer<typeof persistedAuthSchema>;

export interface AuthStorage {
  read(): PersistedAuth | null;
  write(value: PersistedAuth): void;
  clear(): void;
}

const STORAGE_KEY = "arimaatic.auth.v1";

/**
 * localStorage-backed implementation used in production.
 *
 * Reads return `null` when nothing is stored OR when the stored value
 * fails validation (e.g. the format changed across deploys). Treating
 * a malformed payload as "missing" is preferable to crashing the SPA.
 */
export class LocalStorageAuthStorage implements AuthStorage {
  read(): PersistedAuth | null {
    if (typeof window === "undefined" || window.localStorage === undefined) {
      return null;
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    try {
      return persistedAuthSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  write(value: PersistedAuth): void {
    if (typeof window === "undefined" || window.localStorage === undefined) {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }

  clear(): void {
    if (typeof window === "undefined" || window.localStorage === undefined) {
      return;
    }
    window.localStorage.removeItem(STORAGE_KEY);
    // Also remove the legacy games-list key from earlier iterations
    // so a returning user does not carry stale state forward. The
    // games list is now an API call.
    window.localStorage.removeItem("arimaatic.games");
  }
}

/**
 * In-memory implementation used by tests. Identical contract.
 */
export class MemoryAuthStorage implements AuthStorage {
  private value: PersistedAuth | null = null;

  read(): PersistedAuth | null {
    return this.value;
  }

  write(value: PersistedAuth): void {
    this.value = value;
  }

  clear(): void {
    this.value = null;
  }
}
