/**
 * Authentication helpers for Fastify route handlers.
 *
 * This module exposes:
 *
 *   - `extractBearerToken(header)` – pull the JWT out of an
 *     `Authorization: Bearer …` header.
 *   - `requireAccessToken(deps, request)` – verify the token, look up
 *     the user, and return both. Throws an `AuthError` (mapped to a
 *     401 by the global error handler) if anything is wrong.
 *
 * The route handlers call `requireAccessToken` at the top of any
 * endpoint that needs an authenticated user. We do not register a
 * Fastify-level `preHandler` hook because not every route is
 * authenticated — keeping the gate at the call site makes the
 * authentication boundary visible in each handler.
 */

import type { FastifyRequest } from "fastify";
import type { UserRecord, UserStore } from "../persistence/store";
import type { AuthTokenSigner } from "./tokens";

/**
 * Custom error type thrown when authentication fails. The Fastify
 * global error handler recognises this and renders a 401 with our
 * standard error envelope.
 */
export class AuthError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public constructor(message: string, code = "unauthorized") {
    super(message);
    this.name = "AuthError";
    this.statusCode = 401;
    this.code = code;
  }
}

/**
 * Pull the bearer credential out of an `Authorization` header value.
 *
 * Returns null when the scheme is missing or wrong; the caller decides
 * whether that should be a 401.
 */
export function extractBearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match === null ? null : match[1];
}

export interface AuthContext {
  readonly user: UserRecord;
  readonly userId: string;
}

export interface RequireAccessTokenDeps {
  readonly userStore: UserStore;
  readonly tokenSigner: AuthTokenSigner;
}

/**
 * Verify the access-token JWT on a request and return the
 * authenticated user. Throws `AuthError` on any failure.
 *
 * We also re-check `isDisabled` at request time. The JWT is short-
 * lived but it is still possible for an admin to disable an account
 * while a token is in flight; rejecting at validation time stops the
 * window earlier than the next refresh.
 */
export async function requireAccessToken(
  deps: RequireAccessTokenDeps,
  request: FastifyRequest,
): Promise<AuthContext> {
  const token = extractBearerToken(request.headers.authorization);
  if (token === null) {
    throw new AuthError("Missing bearer token", "missing-token");
  }
  let claims: Awaited<ReturnType<typeof deps.tokenSigner.verifyAccessToken>>;
  try {
    claims = await deps.tokenSigner.verifyAccessToken(token);
  } catch {
    throw new AuthError("Invalid or expired access token", "invalid-token");
  }
  const user = await deps.userStore.getById(claims.sub);
  if (user === null) {
    throw new AuthError("Token owner no longer exists", "unknown-user");
  }
  if (user.isDisabled) {
    throw new AuthError("Account is disabled", "account-disabled");
  }
  return { user, userId: user.id };
}
