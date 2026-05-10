/**
 * AuthStorage — the only browser-side state that survives page reloads.
 *
 * The refresh token is now an httpOnly cookie (`rt`) delivered by the
 * server; JavaScript never touches it. The only thing worth persisting
 * here is the last-known user profile, which lets us render the navbar
 * instantly on cold load while the silent access-token refresh is in
 * flight.
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
 * - `user` is the last-known profile; useful for rendering the navbar
 *   instantly on cold load while the access-token refresh is in flight.
 *
 * Version 2 — version 1 included the refresh token in the blob.
 * The token is now an httpOnly cookie so version 1 blobs are
 * intentionally treated as absent (stale reads return null).
 */
const persistedAuthSchema = z.object({
  version: z.literal(2),
  user: userProfileSchema,
});

export type PersistedAuth = z.infer<typeof persistedAuthSchema>;

export interface AuthStorage {
  read(): PersistedAuth | null;
  /** Persist the user profile cache. Only the profile is stored — the
   *  refresh token lives in an httpOnly cookie that JS cannot access. */
  write(user: PersistedAuth["user"]): void;
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

  write(user: PersistedAuth["user"]): void {
    if (typeof window === "undefined" || window.localStorage === undefined) {
      return;
    }
    const blob: PersistedAuth = { version: 2, user };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
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

  write(user: PersistedAuth["user"]): void {
    this.value = { version: 2, user };
  }

  clear(): void {
    this.value = null;
  }
}
