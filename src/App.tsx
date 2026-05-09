/**
 * Root application component.
 *
 * Composes the network adapters with the TanStack Router. The
 * adapters are constructed once here so the entire SPA shares a
 * single API client and websocket factory; tests render their own
 * provider stack with fakes instead of using this component.
 */

import { RouterProvider } from "@tanstack/react-router";
import { HttpApiClient } from "./network/api";
import { NetworkProvider } from "./network/context";
import { WebSocketSessionSocket } from "./network/socket";
import { router } from "./router";

// When VITE_API_URL is set (e.g. `dev:docker`) it takes precedence so
// requests go to the external Docker API instead of the local origin.
// Without it we fall back to the Vite base path, stripping the trailing
// slash so appending "/api/..." never produces a double-slash.
const apiBase =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const api = new HttpApiClient(apiBase);
const socket = new WebSocketSessionSocket(apiBase);

export function App() {
  return (
    <NetworkProvider value={{ api, socket }}>
      <RouterProvider router={router} />
    </NetworkProvider>
  );
}
