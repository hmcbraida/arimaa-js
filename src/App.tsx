/**
 * Root application component.
 *
 * Composes the network and auth adapters with the TanStack Router.
 * The adapters are constructed once here so the entire SPA shares a
 * single auth API client, game API client, websocket factory, and
 * auth-storage handle. Tests render their own provider stack with the
 * in-memory fakes instead of using this component.
 */

import { RouterProvider } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { AuthProvider } from "./auth/AuthProvider";
import type { AuthState } from "./auth/authContextValue";
import { useAuth } from "./auth/useAuth";
import { HttpAuthApiClient } from "./network/authApi";
import { LocalStorageAuthStorage } from "./network/authStorage";
import { NetworkProvider } from "./network/context";
import { HttpGameSessionApiClient } from "./network/gameApi";
import { WebSocketSessionSocket } from "./network/socket";
import { router } from "./router";

// When VITE_API_URL is set (e.g. `dev:docker`) it takes precedence so
// requests go to the external Docker API instead of the local origin.
// Without it we fall back to the Vite base path, stripping the trailing
// slash so appending "/api/..." never produces a double-slash.
const apiBase =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const authApi = new HttpAuthApiClient(apiBase);
const gameApi = new HttpGameSessionApiClient(apiBase);
const socket = new WebSocketSessionSocket(apiBase);
const authStorage = new LocalStorageAuthStorage();

/**
 * Inner component rendered inside `AuthProvider` so it can read the
 * current auth state and thread it into the router's context.
 *
 * Using a ref-backed stable callback avoids re-creating the context
 * object on every render while still guaranteeing `beforeLoad` always
 * sees the latest state.  `router.invalidate()` is called whenever the
 * auth state *kind* changes so the route guards re-evaluate immediately
 * (e.g. redirect an authenticated user away from `/login` after a
 * background refresh transitions from `loading` to `authenticated`).
 */
function AuthRouterProvider() {
  const { state } = useAuth();
  const stateRef = useRef<AuthState>(state);
  stateRef.current = state;

  const getAuthState = useCallback((): AuthState => stateRef.current, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: state.kind is a trigger-only dependency; the effect calls router.invalidate() rather than reading the value directly
  useEffect(() => {
    void router.invalidate();
  }, [state.kind]);

  return <RouterProvider router={router} context={{ getAuthState }} />;
}

export function App() {
  return (
    <NetworkProvider value={{ authApi, gameApi, socket }}>
      <AuthProvider api={authApi} storage={authStorage}>
        <AuthRouterProvider />
      </AuthProvider>
    </NetworkProvider>
  );
}
