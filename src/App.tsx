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

// Singleton adapters — the SPA only ever needs one of each.
const api = new HttpApiClient();
const socket = new WebSocketSessionSocket();

export function App() {
  return (
    <NetworkProvider value={{ api, socket }}>
      <RouterProvider router={router} />
    </NetworkProvider>
  );
}
