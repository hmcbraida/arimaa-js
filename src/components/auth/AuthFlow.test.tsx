/**
 * Component-level tests covering the auth-area screens.
 *
 * These tests render the React components in a happy-dom-backed
 * environment and exercise them through real DOM events using
 * `@testing-library/react` and `@testing-library/user-event`. The
 * network layer is replaced with the in-memory `FakeAuthApiClient` /
 * `FakeGameSessionApiClient` so the entire flow runs without a backend.
 *
 * To keep the test scope tight we render single screens (rather than
 * the full router) and verify the externally observable effects on
 * the auth context's storage and the fake state.
 */

import "./setupDom";

import { afterEach, describe, expect, it } from "bun:test";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { AuthProvider } from "../../auth/AuthProvider";
import { MemoryAuthStorage } from "../../network/authStorage";
import { NetworkProvider } from "../../network/context";
import {
  type FakeAuthApiClient,
  type FakeGameSessionApiClient,
  type FakeNetworkState,
  buildFakeNetwork,
} from "../../network/fake";
import type { SessionSocket } from "../../network/socket";
import { ForgotPasswordScreen } from "./ForgotPasswordScreen";
import { LoginScreen } from "./LoginScreen";
import { RegisterScreen } from "./RegisterScreen";

const noopSocket: SessionSocket = {
  subscribe: () => () => undefined,
};

interface Harness {
  state: FakeNetworkState;
  authApi: FakeAuthApiClient;
  gameApi: FakeGameSessionApiClient;
  storage: MemoryAuthStorage;
}

/**
 * Build a minimal router that only knows about a single component.
 * The auth-area screens themselves use `<Link to="/login">` and
 * `useNavigate({ to: "/" })`, so we still need a real router; we
 * just give it a single matchable path that mounts the screen
 * under test.
 */
function renderScreen(
  Component: () => ReactNode,
  harness?: Partial<Harness>,
): Harness {
  // Always build a fresh fake network bundle so we have a guaranteed
  // source for any field the caller did not pre-provide.
  const fake = buildFakeNetwork();
  const state = harness?.state ?? fake.state;
  const authApi = harness?.authApi ?? fake.authApi;
  const gameApi = harness?.gameApi ?? fake.gameApi;
  const storage = harness?.storage ?? new MemoryAuthStorage();

  // Build a router with all the paths the auth screens link to so
  // that `<Link to="/login">` etc. type-check and resolve. Each
  // child route just renders an empty placeholder — the test
  // never navigates into them.
  const root = createRootRoute({ component: () => <Outlet /> });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <div data-testid="route-home">home</div>,
  });
  const login = createRoute({
    getParentRoute: () => root,
    path: "/login",
    component: () => <div data-testid="route-login">login</div>,
  });
  const register = createRoute({
    getParentRoute: () => root,
    path: "/register",
    component: () => <div data-testid="route-register">register</div>,
  });
  const forgot = createRoute({
    getParentRoute: () => root,
    path: "/forgot-password",
    component: () => <div data-testid="route-forgot">forgot</div>,
  });
  const loginPending = createRoute({
    getParentRoute: () => root,
    path: "/login-pending",
    component: () => <div data-testid="route-login-pending">login-pending</div>,
  });
  const screenRoute = createRoute({
    getParentRoute: () => root,
    path: "/_test-screen",
    component: Component,
  });
  const tree = root.addChildren([
    home,
    login,
    register,
    forgot,
    loginPending,
    screenRoute,
  ]);
  const router = createRouter({
    routeTree: tree,
    history: createMemoryHistory({ initialEntries: ["/_test-screen"] }),
  });

  render(
    <NetworkProvider value={{ authApi, gameApi, socket: noopSocket }}>
      <AuthProvider api={authApi} storage={storage}>
        <RouterProvider router={router} />
      </AuthProvider>
    </NetworkProvider>,
  );
  return { state, authApi, gameApi, storage };
}

afterEach(() => {
  cleanup();
});

/* --------------------------------------------------------------------- */
/* Registration                                                          */
/* --------------------------------------------------------------------- */

describe("RegisterScreen", () => {
  it("creates an account, persists the refresh token, and triggers a verification email", async () => {
    const harness = renderScreen(RegisterScreen);
    const user = userEvent.setup();

    await screen.findByRole("button", { name: /create account/i });

    await user.type(screen.getByLabelText(/username/i), "alice");
    await user.type(
      screen.getByLabelText(/email address/i),
      "alice@example.test",
    );
    await user.type(screen.getByLabelText(/^password$/i), "supersecure");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(harness.storage.read()).not.toBeNull();
    });
    expect(harness.state.users).toHaveLength(1);
    expect(
      harness.state.emails.some((e) => e.subject.includes("Confirm")),
    ).toBe(true);
  });
});

/* --------------------------------------------------------------------- */
/* Login                                                                 */
/* --------------------------------------------------------------------- */

describe("LoginScreen", () => {
  it("shows an inline error on wrong password", async () => {
    const fake = buildFakeNetwork();
    fake.state.users.push({
      id: "u1",
      username: "alice",
      password: "supersecure",
      emailAddress: "a@a.test",
      rCreated: new Date().toISOString(),
      lastLogin: null,
      isActivated: true,
      isDisabled: false,
    });
    renderScreen(LoginScreen, fake);
    const user = userEvent.setup();

    await screen.findByRole("button", { name: /sign in/i });
    await user.type(screen.getByLabelText(/username or email/i), "alice");
    await user.type(screen.getByLabelText(/password/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/invalid/i);
  });

  it("authenticates an activated user and writes the auth blob to storage", async () => {
    const fake = buildFakeNetwork();
    fake.state.users.push({
      id: "u2",
      username: "bob",
      password: "supersecure",
      emailAddress: "b@a.test",
      rCreated: new Date().toISOString(),
      lastLogin: null,
      isActivated: true,
      isDisabled: false,
    });
    const harness = renderScreen(LoginScreen, fake);
    const user = userEvent.setup();

    await screen.findByRole("button", { name: /sign in/i });
    await user.type(screen.getByLabelText(/username or email/i), "bob");
    await user.type(screen.getByLabelText(/password/i), "supersecure");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      const persisted = harness.storage.read();
      expect(persisted).not.toBeNull();
      expect(persisted?.user.username).toBe("bob");
    });
  });
});

/* --------------------------------------------------------------------- */
/* Login navigation                                                      */
/* --------------------------------------------------------------------- */

describe("LoginScreen — post-submit navigation", () => {
  it("navigates to /login-pending when signing in to an unactivated account", async () => {
    const fake = buildFakeNetwork();
    fake.state.users.push({
      id: "u3",
      username: "carol",
      password: "supersecure",
      emailAddress: "carol@test.test",
      rCreated: new Date().toISOString(),
      lastLogin: null,
      isActivated: false,
      isDisabled: false,
    });
    renderScreen(LoginScreen, fake);
    const user = userEvent.setup();

    await screen.findByRole("button", { name: /sign in/i });
    await user.type(screen.getByLabelText(/username or email/i), "carol");
    await user.type(screen.getByLabelText(/password/i), "supersecure");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByTestId("route-login-pending")).toBeTruthy(),
    );
  });

  it("navigates to / when signing in to an activated account", async () => {
    const fake = buildFakeNetwork();
    fake.state.users.push({
      id: "u4",
      username: "dave",
      password: "supersecure",
      emailAddress: "dave@test.test",
      rCreated: new Date().toISOString(),
      lastLogin: null,
      isActivated: true,
      isDisabled: false,
    });
    renderScreen(LoginScreen, fake);
    const user = userEvent.setup();

    await screen.findByRole("button", { name: /sign in/i });
    await user.type(screen.getByLabelText(/username or email/i), "dave");
    await user.type(screen.getByLabelText(/password/i), "supersecure");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(screen.getByTestId("route-home")).toBeTruthy());
  });
});

/* --------------------------------------------------------------------- */
/* Register navigation                                                   */
/* --------------------------------------------------------------------- */

describe("RegisterScreen — post-submit navigation", () => {
  it("navigates to /login-pending after creating a new account", async () => {
    renderScreen(RegisterScreen);
    const user = userEvent.setup();

    await screen.findByRole("button", { name: /create account/i });
    await user.type(screen.getByLabelText(/username/i), "newuser");
    await user.type(
      screen.getByLabelText(/email address/i),
      "newuser@test.test",
    );
    await user.type(screen.getByLabelText(/^password$/i), "supersecure");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() =>
      expect(screen.getByTestId("route-login-pending")).toBeTruthy(),
    );
  });
});

/* --------------------------------------------------------------------- */
/* Password reset                                                        */
/* --------------------------------------------------------------------- */

describe("ForgotPasswordScreen", () => {
  it("shows the silent confirmation message even when the email is unknown", async () => {
    renderScreen(ForgotPasswordScreen);
    const user = userEvent.setup();
    await screen.findByRole("button", { name: /send reset link/i });
    await user.type(
      screen.getByLabelText(/email address/i),
      "ghost@example.test",
    );
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/if an account exists for that address/i),
      ).toBeTruthy(),
    );
  });

  it("emails an existing user a reset link", async () => {
    const fake = buildFakeNetwork();
    fake.state.users.push({
      id: "u4",
      username: "real",
      password: "supersecure",
      emailAddress: "real@a.test",
      rCreated: new Date().toISOString(),
      lastLogin: null,
      isActivated: true,
      isDisabled: false,
    });
    const harness = renderScreen(ForgotPasswordScreen, fake);
    const user = userEvent.setup();
    await screen.findByRole("button", { name: /send reset link/i });
    await user.type(screen.getByLabelText(/email address/i), "real@a.test");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() =>
      expect(harness.state.emails.some((e) => e.to === "real@a.test")).toBe(
        true,
      ),
    );
  });
});
