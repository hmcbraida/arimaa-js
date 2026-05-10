/**
 * Game-session API client.
 *
 * Mirrors `AuthApiClient` in shape: an interface (`GameSessionApiClient`),
 * a production HTTP implementation, and an in-memory fake (in
 * `gameApi.fake.ts`). The split between this and `authApi.ts` keeps
 * concerns separate — auth and gameplay can evolve independently.
 *
 * Every method except `getSession` requires an access token; getSession
 * is intentionally anonymous because the public-spectator flow exists
 * (any URL on `/sessions/:id` should render a board, even for a logged-
 * out viewer).
 */

import {
  type AcceptSessionRequest,
  type AcceptSessionResponse,
  type CreateSessionResponse,
  type GetSessionResponse,
  type ListUserSessionsQuery,
  type ListUserSessionsResponse,
  type Side,
  type SubmitMoveRequest,
  type SubmitMoveResponse,
  acceptSessionResponseSchema,
  createSessionResponseSchema,
  getSessionResponseSchema,
  listUserSessionsResponseSchema,
  submitMoveResponseSchema,
} from "../shared/schema";
import { parseOrThrow } from "./api";

/**
 * Public interface. Each method is one HTTP call.
 */
export interface GameSessionApiClient {
  /** Create a new game on behalf of an authenticated user. */
  createSession(args: {
    accessToken: string;
    side: Side;
  }): Promise<CreateSessionResponse>;

  /** Join an existing game by accept code. */
  acceptSession(args: {
    accessToken: string;
    body: AcceptSessionRequest;
  }): Promise<AcceptSessionResponse>;

  /** Public read of a session (anonymous spectating allowed). */
  getSession(sessionId: string): Promise<GetSessionResponse>;

  /** Submit a move. */
  submitMove(args: {
    accessToken: string;
    sessionId: string;
    body: SubmitMoveRequest;
  }): Promise<SubmitMoveResponse>;

  /** Paginated list of the authenticated user's games. */
  listMySessions(args: {
    accessToken: string;
    query: ListUserSessionsQuery;
  }): Promise<ListUserSessionsResponse>;
}

export class HttpGameSessionApiClient implements GameSessionApiClient {
  public constructor(private readonly baseUrl: string = "") {}

  async createSession(args: {
    accessToken: string;
    side: Side;
  }): Promise<CreateSessionResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/sessions?side=${encodeURIComponent(args.side)}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${args.accessToken}` },
      },
    );
    return parseOrThrow(response, createSessionResponseSchema);
  }

  async acceptSession(args: {
    accessToken: string;
    body: AcceptSessionRequest;
  }): Promise<AcceptSessionResponse> {
    const response = await fetch(`${this.baseUrl}/api/session-accept`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${args.accessToken}`,
      },
      body: JSON.stringify(args.body),
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
    accessToken: string;
    sessionId: string;
    body: SubmitMoveRequest;
  }): Promise<SubmitMoveResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(args.sessionId)}/moves`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${args.accessToken}`,
        },
        body: JSON.stringify(args.body),
      },
    );
    return parseOrThrow(response, submitMoveResponseSchema);
  }

  async listMySessions(args: {
    accessToken: string;
    query: ListUserSessionsQuery;
  }): Promise<ListUserSessionsResponse> {
    const params = new URLSearchParams();
    if (args.query.limit !== undefined) {
      params.set("limit", String(args.query.limit));
    }
    if (args.query.cursor !== undefined) {
      params.set("cursor", args.query.cursor);
    }
    const qs = params.toString();
    const response = await fetch(
      `${this.baseUrl}/api/users/me/sessions${qs.length > 0 ? `?${qs}` : ""}`,
      { headers: { authorization: `Bearer ${args.accessToken}` } },
    );
    return parseOrThrow(response, listUserSessionsResponseSchema);
  }
}
