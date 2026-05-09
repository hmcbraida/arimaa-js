/**
 * Bare React context value for the network adapters.
 *
 * Lives in its own non-JSX file so the React Fast Refresh tooling can
 * recompile only the provider component (`context.tsx`) when its body
 * changes, without invalidating the context identity.
 */

import { createContext } from "react";
import type { ApiClient } from "./api";
import type { SessionSocket } from "./socket";

export interface NetworkValue {
  readonly api: ApiClient;
  readonly socket: SessionSocket;
}

export const NetworkContext = createContext<NetworkValue | null>(null);
