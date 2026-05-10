/**
 * Bare React context for the network adapters.
 *
 * Lives in its own non-JSX file so the React Fast Refresh tooling can
 * recompile only the provider component (`context.tsx`) when its body
 * changes, without invalidating the context identity.
 *
 * The context now exposes three adapters: the auth API, the game API,
 * and the websocket. Auth-flow state (the current user, the access
 * token, etc.) is managed by `AuthContext`, not here — the network
 * context is just the transport layer.
 */

import { createContext } from "react";
import type { AuthApiClient } from "./authApi";
import type { GameSessionApiClient } from "./gameApi";
import type { SessionSocket } from "./socket";

export interface NetworkValue {
  readonly authApi: AuthApiClient;
  readonly gameApi: GameSessionApiClient;
  readonly socket: SessionSocket;
}

export const NetworkContext = createContext<NetworkValue | null>(null);
