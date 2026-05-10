/**
 * Bare context object for the auth state.
 *
 * Lives in its own non-JSX file so React Fast Refresh can hot-reload
 * the provider component without invalidating the context identity.
 * The shape and helpers are documented in `AuthProvider.tsx`.
 */

import { createContext } from "react";
import type { RefreshFailureReason, UserProfile } from "../shared/schema";

/**
 * The discriminated state the rest of the SPA observes via
 * `useAuth()`.
 *
 *   - `anonymous`     no cached session; show login screen
 *   - `loading`       cached user found; checking the `rt` cookie right now
 *   - `authenticated` happy path; we have a fresh access token
 *   - `pending`       cookie exists but cannot be redeemed
 *                     (account-not-activated, account-disabled, …);
 *                     show the special "stuck on login" screen
 */
export type AuthState =
  | { kind: "anonymous" }
  | { kind: "loading" }
  | {
      kind: "authenticated";
      user: UserProfile;
      accessToken: string;
      accessTokenExpiresAt: string;
    }
  | {
      kind: "pending";
      reason: RefreshFailureReason;
      user: UserProfile | null;
    };

/**
 * Public actions exposed by the provider.
 *
 * `accessToken()` returns the currently-cached access token, or null
 * if none is available — the games tab and network game view call it
 * when assembling outgoing requests.
 *
 * `signIn` / `register` set `state` to `authenticated` (or `pending`)
 * synchronously after the network round-trip resolves. `cancelSignIn`
 * is the user-initiated abort from the login-pending screen — it
 * clears the persisted refresh token and returns to the anonymous
 * state.
 */
export interface AuthContextValue {
  state: AuthState;
  /** Currently-cached access token, or null if none. */
  accessToken(): string | null;
  /**
   * Re-attempt the refresh-token exchange. Used after the user
   * confirms their email so the screen can transition out of the
   * "pending" state without a full reload.
   *
   * Returns the resolved `AuthState` so the caller can navigate
   * immediately without waiting for a re-render cycle.
   */
  retryRedeem(): Promise<AuthState>;
  /**
   * Returns the resolved `AuthState` (`authenticated` or `pending`)
   * so the caller can navigate immediately.
   */
  signIn(args: {
    usernameOrEmail: string;
    password: string;
  }): Promise<AuthState>;
  /**
   * Returns the resolved `AuthState` (always `pending` for a fresh
   * registration) so the caller can navigate immediately.
   */
  register(args: {
    username?: string;
    emailAddress: string;
    password: string;
  }): Promise<AuthState>;
  signOut(): Promise<void>;
  /**
   * Abort an in-progress login (clears the stuck refresh token).
   * Always resolves to `{ kind: "anonymous" }`.
   */
  cancelSignIn(): Promise<AuthState>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
