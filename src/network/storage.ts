/**
 * LocalStorage-backed records of the games this browser is involved in.
 *
 * The games tab in the UI reads this list to render the table and to
 * decide whether the current viewer holds a player credential for a
 * given session (in which case they get an interactive board) or is
 * just a spectator (read-only board).
 *
 * Storing the per-side secret in localStorage is a deliberate trade-off
 * for this iteration: it keeps the API surface small and the UI
 * stateless, at the cost of a sticky session bound to one browser
 * profile. A future iteration could swap this module for a server-side
 * cookie if cross-device play becomes important.
 */

import { z } from "zod";
import { sideSchema } from "../shared/schema";

/**
 * Public shape of a single stored game entry.
 *
 * - `sessionId`        the session uuid
 * - `role`             "player" if we hold a secret token, "spectator" otherwise
 * - `side`             populated only for player roles
 * - `secretToken`      populated only for player roles
 * - `acceptToken`      populated only for the creator while waiting for opponent
 * - `addedAt`          ISO timestamp the row was inserted (used for sort order)
 */
const storedGameSchema = z.object({
  sessionId: z.string().uuid(),
  role: z.enum(["player", "spectator"]),
  side: sideSchema.nullable(),
  secretToken: z.string().nullable(),
  acceptToken: z
    .string()
    .regex(/^\d{8}$/)
    .nullable(),
  addedAt: z.string(),
});
export type StoredGame = z.infer<typeof storedGameSchema>;

/**
 * The full localStorage payload — an array of stored games plus a
 * version field so we can migrate the format in the future without
 * silently corrupting data.
 */
const storageDocumentSchema = z.object({
  version: z.literal(1),
  games: z.array(storedGameSchema),
});
type StorageDocument = z.infer<typeof storageDocumentSchema>;

const STORAGE_KEY = "arimaatic.games";

/**
 * Read the persisted document, or an empty default if nothing has
 * been stored yet or the value fails validation.
 *
 * Validation failure is treated as "missing" because the most likely
 * cause is a stale shape from an older version of the code, and
 * silently starting from a clean state is preferable to crashing the
 * entire SPA.
 */
function readDocument(): StorageDocument {
  if (typeof window === "undefined" || window.localStorage === undefined) {
    return { version: 1, games: [] };
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return { version: 1, games: [] };
  }
  try {
    return storageDocumentSchema.parse(JSON.parse(raw));
  } catch {
    return { version: 1, games: [] };
  }
}

/**
 * Persist a document. Wrapped in a function for the same reason
 * `readDocument` is — both sides treat localStorage as an effectful
 * boundary that should not appear inline in business logic.
 */
function writeDocument(doc: StorageDocument): void {
  if (typeof window === "undefined" || window.localStorage === undefined) {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
}

/**
 * Return all stored games sorted by `addedAt` descending so the UI
 * sees newest first without a per-component sort.
 */
export function listStoredGames(): StoredGame[] {
  const doc = readDocument();
  return [...doc.games].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

/**
 * Add a new entry. If one with the same session id already exists we
 * replace it; this lets the "join an existing game" flow upgrade an
 * existing spectator entry to a player entry without producing a
 * duplicate row.
 */
export function upsertStoredGame(game: StoredGame): void {
  const doc = readDocument();
  const index = doc.games.findIndex((g) => g.sessionId === game.sessionId);
  if (index >= 0) {
    doc.games[index] = game;
  } else {
    doc.games.push(game);
  }
  writeDocument(doc);
}

/**
 * Look up a single stored game by id.
 *
 * Used by the network game view to discover whether the current viewer
 * holds player credentials for the session in the URL.
 */
export function getStoredGame(sessionId: string): StoredGame | null {
  const doc = readDocument();
  return doc.games.find((g) => g.sessionId === sessionId) ?? null;
}

/**
 * Remove a stored game by id.
 *
 * Currently only used internally by tests; exposing it lets a future
 * UI feature (a "remove from list" button on the games table) reuse
 * the same code path.
 */
export function removeStoredGame(sessionId: string): void {
  const doc = readDocument();
  doc.games = doc.games.filter((g) => g.sessionId !== sessionId);
  writeDocument(doc);
}
