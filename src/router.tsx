/**
 * TanStack Router configuration for the Arimaatic SPA.
 *
 * The route tree is split across two layouts:
 *
 *   - The **auth area** -- `/login`, `/register`, `/forgot-password`,
 *     `/reset-password`, `/verify-email`, `/login-pending`. These
 *     screens render outside the in-app tab strip; they exist as
 *     standalone pages because the tabs are conceptually navigation
 *     between in-app sections, and a not-yet-signed-in user has no
 *     such sections to navigate.
 *
 *   - The **app area** -- `/`, `/offline`, `/sessions/:id`,
 *     `/preferences`. These render inside the standard `AppShell`,
 *     which draws the heading, the user menu, and the tab strip
 *     (`/preferences` is not a tab itself but reuses the chrome per
 *     spec).
 *
 * The actual gate that says "redirect to /login if not authenticated"
 * is implemented at the leaf-component level (in `GamesTab` and
 * `PreferencesPage`) so that public routes (e.g. spectating a session
 * URL while logged out) remain visible.
 */

import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { Outlet } from "@tanstack/react-router";
import type { AuthState } from "./auth/authContextValue";
import { AppShell } from "./components/AppShell";
import { PreferencesPage } from "./components/PreferencesPage";
import { ForgotPasswordScreen } from "./components/auth/ForgotPasswordScreen";
import { LoginPendingScreen } from "./components/auth/LoginPendingScreen";
import { LoginScreen } from "./components/auth/LoginScreen";
import { RegisterScreen } from "./components/auth/RegisterScreen";
import { ResetPasswordScreen } from "./components/auth/ResetPasswordScreen";
import { VerifyEmailScreen } from "./components/auth/VerifyEmailScreen";
import { GamesTab } from "./components/games/GamesTab";
import { NetworkGameTab } from "./components/games/NetworkGameTab";
import { OfflineTab } from "./components/games/OfflineTab";

/**
 * Context threaded through every route via `RouterProvider`.
 *
 * `getAuthState` is a stable callback (backed by a ref in
 * `AuthRouterProvider`) so it always returns the latest state without
 * the route tree needing to re-create itself on every auth change.
 */
export interface RouterContext {
  getAuthState: () => AuthState;
}

/**
 * Guard shared by auth screens that should be inaccessible once the
 * user has an active session.  Skips during the initial `loading`
 * window so the screen can render its own skeleton rather than
 * bouncing prematurely.
 *
 * The `context` parameter is typed as `unknown` because TanStack
 * Router's route types can't resolve the router context at route-
 * creation time (routes are created before the router that carries the
 * context type).  The cast is safe: `AuthRouterProvider` always injects
 * a real `RouterContext` before any route resolves.
 */
function redirectAuthenticatedUser(opts: { context: unknown }): void {
  const { getAuthState } = opts.context as RouterContext;
  const s = getAuthState();
  if (s.kind === "loading") return;
  if (s.kind === "authenticated") throw redirect({ to: "/" });
  if (s.kind === "pending") throw redirect({ to: "/login-pending" });
}

/**
 * The root route renders only an `<Outlet />` because we want some
 * children (auth-area screens) to skip the AppShell entirely. Each
 * child route decides whether to wrap itself in the shell.
 */
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

/* ---------- App-area routes (use the AppShell wrapper) ---------- */

const appShellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app-shell",
  component: AppShell,
});

const gamesRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/",
  component: GamesTab,
});

const offlineRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/offline",
  component: OfflineTab,
});

const sessionRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/sessions/$id",
  component: NetworkGameTab,
});

const preferencesRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/preferences",
  component: PreferencesPage,
});

/* ---------- Auth-area routes (no AppShell) ---------- */

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: redirectAuthenticatedUser,
  component: LoginScreen,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  beforeLoad: redirectAuthenticatedUser,
  component: RegisterScreen,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: ForgotPasswordScreen,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  component: ResetPasswordScreen,
});

const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/verify-email",
  component: VerifyEmailScreen,
});

const loginPendingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login-pending",
  beforeLoad: (opts: { context: unknown }) => {
    const { getAuthState } = opts.context as RouterContext;
    const s = getAuthState();
    if (s.kind === "loading") return;
    if (s.kind === "authenticated") throw redirect({ to: "/" });
    if (s.kind === "anonymous") throw redirect({ to: "/login" });
  },
  component: LoginPendingScreen,
});

const routeTree = rootRoute.addChildren([
  appShellRoute.addChildren([
    gamesRoute,
    offlineRoute,
    sessionRoute,
    preferencesRoute,
  ]),
  loginRoute,
  registerRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  verifyEmailRoute,
  loginPendingRoute,
]);

export const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL,
  // Initial placeholder; the real callback is injected by AuthRouterProvider
  // in App.tsx before any route resolves, so this is never called in
  // production.  The cast is safe because AuthRouterProvider always
  // provides a real value before RouterProvider mounts.
  context: {
    getAuthState: () => ({ kind: "anonymous" }) as AuthState,
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
