/**
 * Token helpers for the authentication system.
 *
 * Three flavours of secret pass through this module:
 *
 *   1. **Refresh tokens** -- long-lived (1 year), opaque random strings.
 *      Stored as SHA-256 hashes in the `refresh_tokens` table.
 *
 *   2. **Access tokens** -- short-lived (15 minutes) signed JWTs. Not
 *      stored anywhere; the JWT is self-contained and verified on every
 *      request via the shared HMAC secret.
 *
 *   3. **Email-verification / password-reset tokens** -- short-lived
 *      (24 h) opaque random strings. Stored as SHA-256 hashes in
 *      dedicated tables. Single-use.
 *
 * Helpers in this file are intentionally small and side-effect free.
 * Production composition reads `JWT_SECRET` from the environment and
 * passes it in to `createAuthTokenSigner` once at startup; tests build
 * a signer with a fixed key.
 */

import { createHash, randomBytes } from "node:crypto";
import { SignJWT, errors as joseErrors, jwtVerify } from "jose";

/* --------------------------------------------------------------------- */
/* Constants                                                              */
/* --------------------------------------------------------------------- */

/**
 * Refresh-token lifetime. Hardcoded to one year per the product spec.
 * Exported so the route layer can compute `expiresAt` consistently.
 */
export const REFRESH_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/** Access-token lifetime -- fifteen minutes. */
export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Email-verification and password-reset token lifetime -- 24 hours. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Length in bytes of the random material used for opaque tokens.
 * 32 bytes (256 bits) is the standard size for opaque API tokens; the
 * hex encoding produces a 64-character string.
 */
const OPAQUE_TOKEN_BYTE_LENGTH = 32;

/* --------------------------------------------------------------------- */
/* Opaque token primitives                                                */
/* --------------------------------------------------------------------- */

/**
 * Generate a fresh opaque token. Used for refresh / email-verification
 * / password-reset secrets -- anything stored as a SHA-256 hash. Hex
 * encoded so the result is URL-safe and trivial to compare.
 */
export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTE_LENGTH).toString("hex");
}

/**
 * SHA-256 hash a token for at-rest storage.
 *
 * SHA-256 is appropriate for these tokens because the inputs already
 * have very high entropy (256 bits of `randomBytes`) -- we are
 * defending against database-leak replay, not password-style guessing
 * attacks.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/* --------------------------------------------------------------------- */
/* Access-token JWT signer                                                */
/* --------------------------------------------------------------------- */

/**
 * Public claims we put into the JWT. The minimum we need to authorise
 * a request is `sub` (the user id) plus the expiry (which `jose`
 * manages via `setExpirationTime`).
 *
 * `iat` is added by `setIssuedAt`; we include it here in the type so
 * verification consumers can read the issued-at without re-parsing.
 */
export interface AccessTokenClaims {
  /** Subject = user id. */
  sub: string;
  /** Issued-at timestamp (seconds since epoch). */
  iat: number;
  /** Expiry timestamp (seconds since epoch). */
  exp: number;
}

/** Issuer / audience values pinned into the JWT. */
const JWT_ISSUER = "arimaatic-api";
const JWT_AUDIENCE = "arimaatic-client";

/**
 * Public interface for issuing and verifying access-token JWTs.
 *
 * We expose a small object rather than free functions so the
 * composition root can hold a single configured instance and inject it
 * into the route handlers. Tests instantiate it with a deterministic
 * secret key.
 */
export interface AuthTokenSigner {
  /**
   * Sign and return an access-token JWT for the given user. The token
   * carries `sub=userId`, `iat=now`, and `exp=now+ACCESS_TOKEN_TTL`.
   */
  signAccessToken(userId: string, now: Date): Promise<string>;

  /**
   * Verify an access-token JWT and return its claims. Throws if the
   * signature is invalid, the token is expired, or the issuer/audience
   * do not match.
   */
  verifyAccessToken(jwt: string): Promise<AccessTokenClaims>;
}

/**
 * Create an `AuthTokenSigner` backed by HS256.
 *
 * The secret is supplied by the composition root (typically from the
 * `JWT_SECRET` environment variable in production). 32 bytes is the
 * recommended minimum entropy for HS256.
 */
export function createAuthTokenSigner(secret: Uint8Array): AuthTokenSigner {
  return {
    async signAccessToken(userId: string, now: Date): Promise<string> {
      const issuedAtSeconds = Math.floor(now.getTime() / 1000);
      const expSeconds =
        issuedAtSeconds + Math.floor(ACCESS_TOKEN_TTL_MS / 1000);
      return new SignJWT({})
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId)
        .setIssuer(JWT_ISSUER)
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt(issuedAtSeconds)
        .setExpirationTime(expSeconds)
        .sign(secret);
    },

    async verifyAccessToken(jwt: string): Promise<AccessTokenClaims> {
      const { payload } = await jwtVerify(jwt, secret, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      const sub = payload.sub;
      const iat = payload.iat;
      const exp = payload.exp;
      if (
        typeof sub !== "string" ||
        typeof iat !== "number" ||
        typeof exp !== "number"
      ) {
        // A well-formed signed JWT with the right secret can still be
        // missing claims if some other issuer used the same key. Treat
        // it the same as a signature failure.
        throw new joseErrors.JWTInvalid(
          "Access token is missing required claims",
        );
      }
      return { sub, iat, exp };
    },
  };
}

/**
 * Convenience wrapper: convert a UTF-8 string secret (e.g. read from
 * `JWT_SECRET`) into the `Uint8Array` that `jose` expects.
 */
export function secretFromString(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}
