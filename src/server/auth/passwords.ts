/**
 * Password hashing wrappers.
 *
 * All call sites go through these helpers rather than calling
 * `Bun.password` directly so that the choice of algorithm and cost
 * parameters lives in exactly one place. The product spec mandates
 * argon2id, which `Bun.password` selects with `algorithm: "argon2id"`.
 *
 * The defaults supplied by Bun (`memoryCost: 19456`, `timeCost: 2`) are
 * the OWASP recommendation for argon2id at the time of writing. We
 * pass them explicitly here so a future Bun release that changes its
 * defaults cannot silently weaken our hashes.
 */

const ARGON2ID_OPTIONS = {
  algorithm: "argon2id",
  memoryCost: 19456,
  timeCost: 2,
} as const;

/**
 * Hash a plaintext password using argon2id. Returns the encoded hash
 * string suitable for storing in `users.password_hash`.
 *
 * The function is async because argon2id is intentionally CPU-bound;
 * Bun runs the hashing on a worker thread so the event loop is not
 * blocked.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return Bun.password.hash(plaintext, ARGON2ID_OPTIONS);
}

/**
 * Verify a plaintext password against a stored hash. Returns `true`
 * iff the password matches the hash.
 *
 * `Bun.password.verify` is constant-time with respect to the encoded
 * hash format and resistant to length-based side channels.
 */
export async function verifyPassword(
  plaintext: string,
  encodedHash: string,
): Promise<boolean> {
  try {
    return await Bun.password.verify(plaintext, encodedHash);
  } catch {
    // A malformed stored hash should not crash the login route — we
    // surface it as an authentication failure so the caller cannot
    // distinguish "wrong password" from "corrupt hash".
    return false;
  }
}
