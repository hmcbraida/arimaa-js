/**
 * AuthProvider — manages refresh-token storage, access-token issuance,
 * and the public `useAuth()` hook surface.
 *
 * The provider holds three pieces of state:
 *
 *   - The persisted refresh token (read from `AuthStorage` on mount;
 *     written back on login / logout).
 *   - The cached access token plus its expiry (in-memory only).
 *   - A discriminated `AuthState` published to consumers.
 *
 * On mount we attempt to redeem any persisted refresh token for an
 * access token. The result drives the initial `AuthState`:
 *
 *   - Server returns `ok: true`  → state = `authenticated`.
 *   - Server returns `ok: false` → state = `pending` (the "stuck on
 *                                  login" screen).
 *   - No refresh token persisted → state = `anonymous`.
 *
 * After the initial redeem, the provider sets a timer to refresh the
 * access token a minute before its expiry. The minute-of-buffer is
 * conservative; tests can override timing by mocking the relevant
 * setTimeout calls — but the real-world consequence of a brief outage
 * is a single 401 followed by an automatic refresh, which is
 * acceptable.
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
  /**
   * Refresh token currently held by the provider. Mirrors what is in
   * `storage`, kept in a ref so the refresh-timer effect can read the
   * latest value without re-running on every state change.
   */
  const refreshTokenRef = useRef<string | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const accessTokenExpiryRef = useRef<number | null>(null);

  /** Persist the new auth blob to storage. Centralised here so we
   * cannot forget to call it after a login / register. */
  const persistAuth = useCallback(
    (args: {
      user: UserProfile;
      refreshToken: string;
      refreshTokenExpiresAt: string;
    }) => {
      storage.write({
        version: 1,
        refreshToken: args.refreshToken,
        refreshTokenExpiresAt: args.refreshTokenExpiresAt,
        user: args.user,
      });
      refreshTokenRef.current = args.refreshToken;
    },
    [storage],
  );

  /** Clear all in-memory and persisted credentials. */
  const wipeAuth = useCallback(() => {
    storage.clear();
    refreshTokenRef.current = null;
    accessTokenRef.current = null;
    accessTokenExpiryRef.current = null;
  }, [storage]);

  /**
   * Try to exchange the stored refresh token for an access token. If
   * the exchange returns `ok: false` we transition to the `pending`
   * state so the UI can show the login-pending screen. If the refresh
   * token itself is invalid (revoked, expired, unknown), we wipe it
   * and go anonymous.
   */
  const redeemRefreshToken = useCallback(
    async (refreshToken: string): Promise<AuthState> => {
      try {
        const result = await api.refreshAccessToken({ refreshToken });
        if (result.ok) {
          accessTokenRef.current = result.accessToken;
          accessTokenExpiryRef.current = Date.parse(
            result.accessTokenExpiresAt,
          );
          // Update the persisted user blob with whatever the server
          // just returned. The refresh token itself does not change.
          const persisted = storage.read();
          if (persisted !== null) {
            storage.write({ ...persisted, user: result.user });
          }
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
        // Network failure: keep the refresh token but treat as
        // anonymous so the user is not locked out of the offline
        // tab. They can retry by reloading the page.
        return { kind: "anonymous" };
      }
    },
    [api, storage, wipeAuth],
  );

  /**
   * Initial load. Runs once on mount.
   */
  useEffect(() => {
    const persisted = storage.read();
    if (persisted === null) {
      setState({ kind: "anonymous" });
      return;
    }
    refreshTokenRef.current = persisted.refreshToken;
    void (async () => {
      const next = await redeemRefreshToken(persisted.refreshToken);
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
        const refreshToken = refreshTokenRef.current;
        if (refreshToken === null) return;
        void (async () => {
          const next = await redeemRefreshToken(refreshToken);
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
      refreshToken: string;
      refreshTokenExpiresAt: string;
      accessToken: string | null;
      accessTokenExpiresAt: string | null;
    }): AuthState => {
      persistAuth({
        user: bundle.user,
        refreshToken: bundle.refreshToken,
        refreshTokenExpiresAt: bundle.refreshTokenExpiresAt,
      });
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
      // No access token issued — the account is unactivated or
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
      // Auto-trigger the verification email per spec. The endpoint
      // is authenticated via the refresh token (not the access
      // token, which the just-registered unactivated user does not
      // have). Best-effort — the login-pending screen has a manual
      // "Resend" button that the user can click if this round-trip
      // fails for any reason.
      try {
        await api.resendVerificationEmail(bundle.refreshToken);
      } catch {
        // Swallow.
      }
      return next;
    },
    [api, applyBundle],
  );

  const signOut = useCallback(async () => {
    const refreshToken = refreshTokenRef.current;
    if (refreshToken !== null) {
      try {
        await api.logout({ refreshToken });
      } catch {
        // Logout is best-effort: the local clear is what matters.
      }
    }
    wipeAuth();
    setState({ kind: "anonymous" });
  }, [api, wipeAuth]);

  const cancelSignIn = useCallback(async (): Promise<AuthState> => {
    // Same effect as signOut but without surfacing the user via
    // the `signedOut` event log (none exists in this build, but the
    // semantic distinction matters for future analytics).
    const refreshToken = refreshTokenRef.current;
    if (refreshToken !== null) {
      try {
        await api.logout({ refreshToken });
      } catch {
        // Best-effort.
      }
    }
    wipeAuth();
    const next: AuthState = { kind: "anonymous" };
    setState(next);
    return next;
  }, [api, wipeAuth]);

  const retryRedeem = useCallback(async (): Promise<AuthState> => {
    const refreshToken = refreshTokenRef.current;
    if (refreshToken === null) {
      const next: AuthState = { kind: "anonymous" };
      setState(next);
      return next;
    }
    setState({ kind: "loading" });
    const next = await redeemRefreshToken(refreshToken);
    setState(next);
    return next;
  }, [redeemRefreshToken]);

  const accessToken = useCallback(() => accessTokenRef.current, []);
  const refreshToken = useCallback(() => refreshTokenRef.current, []);

  const value: AuthContextValue = useMemo(
    () => ({
      state,
      accessToken,
      refreshToken,
      retryRedeem,
      signIn,
      register,
      signOut,
      cancelSignIn,
    }),
    [
      state,
      accessToken,
      refreshToken,
      retryRedeem,
      signIn,
      register,
      signOut,
      cancelSignIn,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
