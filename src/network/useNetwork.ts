/**
 * Hook for consuming the network adapter context.
 *
 * Lives in its own module (separate from `context.tsx`) so the React
 * Fast Refresh plugin can hot-update components that import the hook
 * without invalidating the provider's state. ESLint's
 * `react-refresh/only-export-components` rule enforces that pattern.
 */

import { useContext } from "react";
import { NetworkContext, type NetworkValue } from "./contextValue";

/**
 * Throws if no provider is mounted upstream -- that scenario should
 * only ever be a developer mistake, so failing loudly is preferable
 * to silently returning null and producing later runtime errors.
 */
export function useNetwork(): NetworkValue {
  const value = useContext(NetworkContext);
  if (value === null) {
    throw new Error("useNetwork must be called inside <NetworkProvider>");
  }
  return value;
}
