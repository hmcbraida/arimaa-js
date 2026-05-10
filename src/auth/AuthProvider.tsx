/**
 * AuthProvider -- manages access-token issuance and the public
 * `useAuth()` hook surface.
 *
 * The refresh token lives exclusively in the `rt` httpOnly cookie set
 * by the server. JavaScript never reads or writes it -- the browser
 * includes it automatically on every qualifying request.
 *
 * The provider holds two pieces of in-memory state:
 *
 *   - The cached access token plus its expiry (never persisted).
 *   - A discriminated `AuthState` published to consumers.
 *
 * Additionally, `localStorage` caches the last-known user profile so
 * the navbar can render instantly on a cold page load while the silent
 * access-token refresh is in flight.
 *
 * On mount the provider checks whether a cached user profile exists in
 * `localStorage`. If so, it fires a silent refresh (the browser sends
 * the `rt` cookie automatically). The result drives `AuthState`:
 *
 *   - Server returns `ok: true`  → state = `authenticated`.
 *   - Server returns `ok: false, reason: "invalid"` → state = `anonymous`
 *                                  (no valid cookie; wipe the cache).
 *   - Server returns `ok: false, reason: …` → state = `pending`.
 *   - No cached user profile → state = `anonymous` immediately.
 *
 * After the initial redeem, a timer refreshes the access token a
 * minute before its expiry, keeping the session alive without polling.
 */

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AuthApiClient } from "../network/authApi";
import type { AuthStorage } from "../network/authStorage";
import type { RefreshFailureReason, UserProfile } from "../shared/schema";
import {
  AuthContext,
  type AuthContextValue,
  type AuthState,
} from "./authContextValue";

interface AuthProviderProps {
  readonly api: AuthApiClient;
  readonly storage: AuthStorage;
  readonly children: ReactNode;
}

/**
 * How long before access-token expiry we trigger a proactive refresh.
 *
 * 60 seconds is a safe window: even a sluggish refresh round-trip
 * fits comfortably, and any drift between client and server clocks
 * smaller than a minute is irrelevant.
 */
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000;

export function AuthProvider({ api, storage, children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>(() => {
    const persisted = storage.read();
    return persisted === null ? { kind: "anonymous" } : { kind: "loading" };
  });
  const accessTokenRef = useRef<string | null>(null);
  const accessTokenExpiryRef = useRef<number | null>(null);

  /** Cache the user profile in localStorage so the navbar can render
   *  immediately on the next cold load. */
  const persistAuth = useCallback(
    (user: UserProfile) => {
      storage.write(user);
    },
    [storage],
  );

  /** Clear the in-memory access token and the localStorage cache.
   *  The `rt` cookie is cleared server-side on logout. */
  const wipeAuth = useCallback(() => {
    storage.clear();
    accessTokenRef.current = null;
    accessTokenExpiryRef.current = null;
  }, [storage]);

  /**
   * Fire a silent access-token refresh. The browser sends the `rt`
   * cookie automatically. If the server returns `ok: false, reason:
   * "invalid"` (no valid cookie, expired, revoked) we wipe the local
   * cache and go anonymous. Other failure reasons transition to the
   * "pending" screen. A network error is treated as anonymous so an
   * offline user is not locked out.
   */
  const redeemRefreshToken = useCallback(async (): Promise<AuthState> => {
    try {
      const result = await api.refreshAccessToken();
      if (result.ok) {
        accessTokenRef.current = result.accessToken;
        accessTokenExpiryRef.current = Date.parse(result.accessTokenExpiresAt);
        persistAuth(result.user);
        return {
          kind: "authenticated",
          user: result.user,
          accessToken: result.accessToken,
          accessTokenExpiresAt: result.accessTokenExpiresAt,
        };
      }
      if (result.reason === "invalid") {
        wipeAuth();
        return { kind: "anonymous" };
      }
      return { kind: "pending", reason: result.reason, user: result.user };
    } catch {
      return { kind: "anonymous" };
    }
  }, [api, persistAuth, wipeAuth]);

  /**
   * Initial load. Runs once on mount. If there is a cached user
   * profile in localStorage we assume a cookie may also exist and fire
   * a silent refresh. Without a cached profile we go straight to
   * anonymous so first-time visitors see no loading flash.
   */
  useEffect(() => {
    const persisted = storage.read();
    if (persisted === null) {
      setState({ kind: "anonymous" });
      return;
    }
    void (async () => {
      const next = await redeemRefreshToken();
      setState(next);
    })();
  }, [storage, redeemRefreshToken]);

  /**
   * Refresh-on-expiry timer. Restarts every time the access-token
   * expiry changes. We schedule a single timer rather than polling,
   * which keeps the work close to zero when the user is idle.
   */
  useEffect(() => {
    if (state.kind !== "authenticated") return;
    const ms =
      Date.parse(state.accessTokenExpiresAt) -
      Date.now() -
      ACCESS_TOKEN_REFRESH_BUFFER_MS;
    const timer = setTimeout(
      () => {
        void (async () => {
          const next = await redeemRefreshToken();
          setState(next);
        })();
      },
      Math.max(0, ms),
    );
    return () => clearTimeout(timer);
  }, [state, redeemRefreshToken]);

  /* ----------------------------------------------------------------- */
  /* Public actions                                                     */
  /* ----------------------------------------------------------------- */

  /**
   * Apply a login/register bundle from the server, update in-memory
   * token refs, persist credentials, and set React state.
   *
   * Returns the resulting `AuthState` so callers can navigate
   * immediately without waiting for a re-render cycle.
   */
  const applyBundle = useCallback(
    (bundle: {
      user: UserProfile;
      accessToken: string | null;
      accessTokenExpiresAt: string | null;
    }): AuthState => {
      persistAuth(bundle.user);
      if (bundle.accessToken !== null && bundle.accessTokenExpiresAt !== null) {
        accessTokenRef.current = bundle.accessToken;
        accessTokenExpiryRef.current = Date.parse(bundle.accessTokenExpiresAt);
        const next: AuthState = {
          kind: "authenticated",
          user: bundle.user,
          accessToken: bundle.accessToken,
          accessTokenExpiresAt: bundle.accessTokenExpiresAt,
        };
        setState(next);
        return next;
      }
      // No access token issued -- the account is unactivated or
      // disabled. The `register` path always lands here for a
      // fresh user; the login path may land here too for an
      // unverified or disabled account.
      const reason: RefreshFailureReason = bundle.user.isDisabled
        ? "account-disabled"
        : "account-not-activated";
      const next: AuthState = { kind: "pending", reason, user: bundle.user };
      setState(next);
      return next;
    },
    [persistAuth],
  );

  const signIn = useCallback(
    async ({
      usernameOrEmail,
      password,
    }: {
      usernameOrEmail: string;
      password: string;
    }): Promise<AuthState> => {
      const bundle = await api.login({ usernameOrEmail, password });
      return applyBundle(bundle);
    },
    [api, applyBundle],
  );

  const register = useCallback(
    async (args: {
      username: string;
      emailAddress: string;
      password: string;
    }): Promise<AuthState> => {
      const bundle = await api.registerUser({
        username: args.username,
        emailAddress: args.emailAddress,
        password: args.password,
      });
      const next = applyBundle(bundle);
      // Auto-trigger the verification email. The server authenticates
      // this via the `rt` cookie (the unactivated user has no access
      // token yet). Best-effort -- the login-pending screen has a
      // manual "Resend" button if the round-trip fails.
      try {
        await api.resendVerificationEmail();
      } catch {
        // Swallow.
      }
      return next;
    },
    [api, applyBundle],
  );

  const signOut = useCallback(async () => {
    try {
      // The server revokes the rt cookie and clears it from the
      // browser's cookie jar in the response.
      await api.logout();
    } catch {
      // Logout is best-effort: the local clear is what matters.
    }
    wipeAuth();
    setState({ kind: "anonymous" });
  }, [api, wipeAuth]);

  const cancelSignIn = useCallback(async (): Promise<AuthState> => {
    await signOut();
    return { kind: "anonymous" };
  }, [signOut]);

  const retryRedeem = useCallback(async (): Promise<AuthState> => {
    setState({ kind: "loading" });
    const next = await redeemRefreshToken();
    setState(next);
    return next;
  }, [redeemRefreshToken]);

  const accessToken = useCallback(() => accessTokenRef.current, []);

  const value: AuthContextValue = useMemo(
    () => ({
      state,
      accessToken,
      retryRedeem,
      signIn,
      register,
      signOut,
      cancelSignIn,
    }),
    [state, accessToken, retryRedeem, signIn, register, signOut, cancelSignIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
