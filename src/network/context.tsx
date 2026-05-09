/**
 * Provider component that publishes the network adapters onto the
 * React context tree.
 *
 * The context object itself lives in `contextValue.ts` so this file
 * exports only a component — that satisfies the React Fast Refresh
 * "only export components" rule and keeps hot reload behaviour
 * predictable during local development.
 */

import type { ReactNode } from "react";
import { NetworkContext, type NetworkValue } from "./contextValue";

export function NetworkProvider({
  value,
  children,
}: {
  readonly value: NetworkValue;
  readonly children: ReactNode;
}) {
  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  );
}
