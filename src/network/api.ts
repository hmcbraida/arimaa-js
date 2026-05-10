/**
 * Shared error type and `fetch` helpers for the network layer.
 *
 * The API surface is split across two specialised clients —
 * `AuthApiClient` (auth-related) and `GameSessionApiClient`
 * (gameplay-related). Both depend on the helpers in this file so the
 * error envelope and the response-parsing flow are identical
 * everywhere.
 *
 * Each response is validated through a shared zod schema before it is
 * returned to the caller. That makes server-contract regressions show
 * up at the call site as a parse error rather than as a confusing
 * render-time crash three components deep.
 */

import type { ZodType } from "zod";

/**
 * Error thrown by both API clients for non-2xx responses.
 *
 * Carries the HTTP status so UI code can branch on it (e.g. render
 * different copy for "wrong turn" vs "invalid move"). The optional
 * `code` mirrors the structured `code` field on the server's error
 * envelope, used by the auth flow to distinguish e.g. `username-taken`
 * from `email-taken`.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string | null;
  public constructor(
    status: number,
    message: string,
    code: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Parse a `fetch` response into a typed body or throw `ApiError`.
 *
 * On non-2xx the function reads the body, attempts to extract a
 * server-supplied `message` and `code`, and throws. On 2xx it parses
 * the JSON through the supplied zod schema; a parse failure is
 * treated as a contract violation and re-thrown as `ApiError(500)`.
 */
export async function parseOrThrow<T>(
  response: Response,
  schema: ZodType<T>,
): Promise<T> {
  const text = await response.text();
  // Empty bodies parse to `null`; for our API that should not happen
  // on a 2xx, but we guard so a stray empty response is not silently
  // accepted.
  const data = text.length === 0 ? null : (JSON.parse(text) as unknown);
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    let code: string | null = null;
    if (data !== null && typeof data === "object") {
      const obj = data as { message?: unknown; code?: unknown };
      if (typeof obj.message === "string") message = obj.message;
      if (typeof obj.code === "string") code = obj.code;
    }
    throw new ApiError(response.status, message, code);
  }
  try {
    return schema.parse(data);
  } catch {
    throw new ApiError(500, "Server response did not match the API contract");
  }
}
