/**
 * Auth / user-account API client.
 *
 * The interface (`AuthApiClient`) is the only thing the React tree
 * imports; the production implementation (`HttpAuthApiClient`) wraps
 * `fetch`, and an in-memory fake (`FakeAuthApiClient`, in
 * `authApi.fake.ts`) is used by component tests.
 *
 * This module covers everything in `docs/auth.md` that does not touch
 * an Arimaa game: registration, login, refresh-token exchange,
 * logout, profile, account deletion, email verification, password
 * reset. Game session calls live in `gameApi.ts`.
 */

import {
  type CompletePasswordResetRequest,
  type CreateUserRequest,
  type CreateUserResponse,
  type EmptyResponse,
  type LoginRequest,
  type LoginResponse,
  type LogoutRequest,
  type RefreshAccessTokenRequest,
  type RefreshAccessTokenResponse,
  type RequestPasswordResetRequest,
  type UserProfile,
  createUserResponseSchema,
  emptyResponseSchema,
  loginResponseSchema,
  refreshAccessTokenResponseSchema,
  userProfileSchema,
} from "../shared/schema";
import { parseOrThrow } from "./api";

/**
 * Public interface for the auth-flow endpoints. Every method
 * corresponds to one HTTP call.
 *
 * `getProfile` and `deleteAccount` take an explicit `accessToken`
 * argument so the client itself stays stateless — token retention
 * lives in the auth context.
 */
export interface AuthApiClient {
  /** Register a new user. */
  registerUser(body: CreateUserRequest): Promise<CreateUserResponse>;

  /** Username/email + password login. */
  login(body: LoginRequest): Promise<LoginResponse>;

  /** Exchange a refresh token for an access token. */
  refreshAccessToken(
    body: RefreshAccessTokenRequest,
  ): Promise<RefreshAccessTokenResponse>;

  /** Revoke a refresh token (logout). Idempotent. */
  logout(body: LogoutRequest): Promise<EmptyResponse>;

  /** Fetch the authenticated user's profile. */
  getProfile(accessToken: string): Promise<UserProfile>;

  /** Hard-delete the authenticated user. */
  deleteAccount(accessToken: string): Promise<EmptyResponse>;

  /**
   * Trigger or re-trigger a verification email. Authenticated via
   * the *refresh* token (passed in the body) because an unactivated
   * user has a refresh token but no access token.
   */
  resendVerificationEmail(refreshToken: string): Promise<EmptyResponse>;

  /** Confirm an email-verification token. */
  confirmEmail(token: string): Promise<EmptyResponse>;

  /** Request a password-reset email. Always succeeds. */
  requestPasswordReset(
    body: RequestPasswordResetRequest,
  ): Promise<EmptyResponse>;

  /** Complete a password reset using the token from the email. */
  completePasswordReset(
    token: string,
    body: CompletePasswordResetRequest,
  ): Promise<EmptyResponse>;
}

/**
 * Production HTTP implementation backed by the browser `fetch`.
 *
 * `baseUrl` is the path prefix that comes before `/api/...` in every
 * request. See `App.tsx` for how it is derived from Vite's BASE_URL.
 */
export class HttpAuthApiClient implements AuthApiClient {
  public constructor(private readonly baseUrl: string = "") {}

  async registerUser(body: CreateUserRequest): Promise<CreateUserResponse> {
    const response = await fetch(`${this.baseUrl}/api/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseOrThrow(response, createUserResponseSchema);
  }

  async login(body: LoginRequest): Promise<LoginResponse> {
    const response = await fetch(`${this.baseUrl}/api/auth/login-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseOrThrow(response, loginResponseSchema);
  }

  async refreshAccessToken(
    body: RefreshAccessTokenRequest,
  ): Promise<RefreshAccessTokenResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/auth/login-sessions/current/refresh-tokens`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return parseOrThrow(response, refreshAccessTokenResponseSchema);
  }

  async logout(body: LogoutRequest): Promise<EmptyResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/auth/login-sessions/current`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return parseOrThrow(response, emptyResponseSchema);
  }

  async getProfile(accessToken: string): Promise<UserProfile> {
    const response = await fetch(`${this.baseUrl}/api/users/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    return parseOrThrow(response, userProfileSchema);
  }

  async deleteAccount(accessToken: string): Promise<EmptyResponse> {
    const response = await fetch(`${this.baseUrl}/api/users/me`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    return parseOrThrow(response, emptyResponseSchema);
  }

  async resendVerificationEmail(refreshToken: string): Promise<EmptyResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/users/me/email/verification`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      },
    );
    return parseOrThrow(response, emptyResponseSchema);
  }

  async confirmEmail(token: string): Promise<EmptyResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/email-verifications/${encodeURIComponent(token)}`,
      { method: "POST" },
    );
    return parseOrThrow(response, emptyResponseSchema);
  }

  async requestPasswordReset(
    body: RequestPasswordResetRequest,
  ): Promise<EmptyResponse> {
    const response = await fetch(`${this.baseUrl}/api/passwords/resets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseOrThrow(response, emptyResponseSchema);
  }

  async completePasswordReset(
    token: string,
    body: CompletePasswordResetRequest,
  ): Promise<EmptyResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/passwords/resets/${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return parseOrThrow(response, emptyResponseSchema);
  }
}
