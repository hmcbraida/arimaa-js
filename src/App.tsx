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

// Strip the trailing slash from the Vite base path so both adapters can
// append "/api/..." without producing a double-slash.  In production behind
// nginx this resolves to "/arimaa"; in tests BASE_URL is "/".
const apiBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const api = new HttpApiClient(apiBase);
const socket = new WebSocketSessionSocket(apiBase);

export function App() {
  return (
    <NetworkProvider value={{ api, socket }}>
      <RouterProvider router={router} />
    </NetworkProvider>
  );
}
