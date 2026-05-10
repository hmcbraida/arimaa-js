/**
 * Hook for consuming the auth context.
 *
 * Lives in its own module (separate from `AuthProvider.tsx`) so the
 * React Fast Refresh plugin can hot-update components that import it
 * without invalidating the provider's state. ESLint's
 * `react-refresh/only-export-components` rule enforces that pattern.
 */

import { useContext } from "react";
import { AuthContext, type AuthContextValue } from "./authContextValue";

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error("useAuth must be called inside <AuthProvider>");
  }
  return value;
}
