/**
 * Browser-side API client for the Arimaa session API.
 *
 * The interface is exposed first so React components depend on the
 * abstraction, not on `fetch`. The default `HttpApiClient` exists for
 * production; a `FakeApiClient` lives next to it (in `apiFake.ts`) and
 * is used by component tests to drive the UI deterministically without
 * spinning up a real backend.
 *
 * Every response is validated through the shared zod schemas before it
 * is returned. That makes server contract regressions show up at the
 * call site as a parse error rather than as a confusing render-time
 * crash three components deep.
 */

import {
  type AcceptSessionRequest,
  type AcceptSessionResponse,
  type CreateSessionResponse,
  type GetSessionResponse,
  type Side,
  type SubmitMoveRequest,
  type SubmitMoveResponse,
  acceptSessionResponseSchema,
  createSessionResponseSchema,
  getSessionResponseSchema,
  submitMoveResponseSchema,
} from "../shared/schema";

/**
 * The error thrown by the API client for non-2xx responses.
 *
 * Carries the HTTP status so UI code can branch on it (for example, to
 * render different copy for "wrong turn" vs "invalid move").
 */
export class ApiError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Public interface that components and hooks depend on.
 *
 * Each method is one HTTP call. The interface is intentionally small —
 * the API itself is small — and identical in shape between the real
 * implementation and the in-memory fake.
 */
export interface ApiClient {
  createSession(side: Side): Promise<CreateSessionResponse>;
  acceptSession(body: AcceptSessionRequest): Promise<AcceptSessionResponse>;
  getSession(sessionId: string): Promise<GetSessionResponse>;
  submitMove(args: {
    sessionId: string;
    secretToken: string;
    body: SubmitMoveRequest;
  }): Promise<SubmitMoveResponse>;
}

/**
 * Production HTTP implementation backed by the browser `fetch`.
 *
 * `baseUrl` is the path prefix that comes before `/api/...` in every request.
 * In production it is `"/arimaatic"` (derived from Vite's BASE_URL), which the
 * outer reverse proxy maps to the container root before the request arrives.
 * For local development pointing directly at the API server it can be a full
 * origin such as `"http://localhost:3001"`.  The default empty string keeps
 * the path as `/api/...` for tests and simple same-origin deployments.
 */
export class HttpApiClient implements ApiClient {
  public constructor(private readonly baseUrl: string = "") {}

  async createSession(side: Side): Promise<CreateSessionResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/sessions?side=${encodeURIComponent(side)}`,
      { method: "POST" },
    );
    return parseOrThrow(response, createSessionResponseSchema);
  }

  async acceptSession(
    body: AcceptSessionRequest,
  ): Promise<AcceptSessionResponse> {
    const response = await fetch(`${this.baseUrl}/api/session-accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseOrThrow(response, acceptSessionResponseSchema);
  }

  async getSession(sessionId: string): Promise<GetSessionResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`,
    );
    return parseOrThrow(response, getSessionResponseSchema);
  }

  async submitMove(args: {
    sessionId: string;
    secretToken: string;
    body: SubmitMoveRequest;
  }): Promise<SubmitMoveResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(args.sessionId)}/moves`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${args.secretToken}`,
        },
        body: JSON.stringify(args.body),
      },
    );
    return parseOrThrow(response, submitMoveResponseSchema);
  }
}

/**
 * Helper that turns a `fetch` response into a parsed body.
 *
 * On non-2xx the function reads the body, attempts to extract a
 * server-supplied `message`, and throws `ApiError`. On 2xx it parses
 * the JSON through the supplied zod schema; a parse failure is treated
 * as a contract violation and re-thrown as `ApiError(500)`.
 */
async function parseOrThrow<T>(
  response: Response,
  schema: { parse(input: unknown): T },
): Promise<T> {
  const text = await response.text();
  // Empty bodies parse to `null`; for our API that should not happen,
  // but we guard so a stray empty response is not silently accepted.
  const data = text.length === 0 ? null : (JSON.parse(text) as unknown);
  if (!response.ok) {
    const message =
      data !== null &&
      typeof data === "object" &&
      "message" in data &&
      typeof (data as { message: unknown }).message === "string"
        ? (data as { message: string }).message
        : `HTTP ${response.status}`;
    throw new ApiError(response.status, message);
  }
  try {
    return schema.parse(data);
  } catch {
    throw new ApiError(500, "Server response did not match the API contract");
  }
}
