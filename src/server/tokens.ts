/**
 * Token generation and hashing utilities for the Arimaa session API.
 *
 * Two kinds of secrets exist in the system:
 *
 * 1. **Player secret tokens** — long, opaque, random strings that authorize
 *    a specific player to make moves on behalf of one side of one session.
 *    Stored as a SHA-256 hash on the server; the plaintext is shown to the
 *    creator exactly once at create-or-accept time.
 *
 * 2. **Accept tokens** — short eight-digit codes shared verbally or via chat
 *    by the session creator with the opponent they want to invite. Hashed
 *    server-side; the plaintext is shown once and consumed (marked expired)
 *    on first successful use.
 *
 * Both kinds use Node's `crypto` module for cryptographic randomness. We
 * intentionally do not use `Math.random()` even for the eight-digit code —
 * eight decimal digits is not a lot of entropy, but a uniformly-distributed
 * random integer is still strictly better than a predictable one.
 */

import { createHash, randomBytes, randomInt } from "node:crypto";

/**
 * Length in bytes of the random material used for player secret tokens.
 *
 * 32 bytes (256 bits) is well above any reasonable brute-force threshold and
 * is the standard size for opaque API tokens. The hex encoding produces a
 * 64-character string which is small enough to fit comfortably in HTTP
 * headers and localStorage.
 */
const SECRET_TOKEN_BYTE_LENGTH = 32;

/**
 * Generate a fresh player secret token.
 *
 * Returned in lowercase hex so it is URL-safe and trivially comparable. The
 * server only ever stores `hashToken(token)`; the plaintext exists in memory
 * just long enough to return to the caller.
 */
export function generateSecretToken(): string {
  return randomBytes(SECRET_TOKEN_BYTE_LENGTH).toString("hex");
}

/**
 * Generate a fresh eight-digit accept code, zero-padded.
 *
 * `randomInt(0, 100_000_000)` returns a uniformly distributed integer in
 * `[0, 1e8)` so every eight-digit string has the same probability of being
 * generated. The padding ensures we never silently produce a shorter code.
 */
export function generateAcceptToken(): string {
  return randomInt(0, 100_000_000).toString().padStart(8, "0");
}

/**
 * SHA-256 hash a token for at-rest storage.
 *
 * SHA-256 is appropriate here because the inputs already have very high
 * entropy (32 bytes random / 27 bits random) — we are not protecting against
 * password-style guessing, we are protecting against database leak replay.
 *
 * Returned as lowercase hex so it can be compared as a plain string both in
 * SQL queries and in the in-memory test fake.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
