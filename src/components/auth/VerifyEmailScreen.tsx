/**
 * `/verify-email` route -- terminal page for the link in the
 * verification email.
 *
 * The token comes from the query string (`?token=…`); we POST it to
 * `/api/email-verifications/{token}` exactly once on mount. Three
 * outcomes:
 *
 *   - 200          → render a success message and a Continue button.
 *   - 4xx          → render the server's error message.
 *   - other error  → render a generic "Try again" message with a
 *                    retry button.
 *
 * The verification endpoint is stateless and idempotent (the *first*
 * call activates; later calls return 404). Strict-mode double-invoke
 * is therefore a problem only on the second call producing a "token
 * already used" error after a successful activation. We guard that
 * with a ref so we POST exactly once even with React 18 Strict Mode.
 */

import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../network/api";
import { useNetwork } from "../../network/useNetwork";
import { Button } from "../ui/Button";
import { AuthLayout } from "./AuthLayout";

type VerifyState =
  | { kind: "verifying" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

export function VerifyEmailScreen() {
  const navigate = useNavigate();
  const { authApi } = useNetwork();
  const { retryRedeem, state: authState } = useAuth();

  // Read the token from the query string. We do not use TanStack
  // Router's typed search-params because we want the route to remain
  // accessible even when the user manually pastes a link.
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";

  const [verifyState, setVerifyState] = useState<VerifyState>({
    kind: "verifying",
  });
  // React 18 Strict Mode invokes effects twice in development; this
  // ref ensures we only POST once.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    if (token.length === 0) {
      setVerifyState({
        kind: "error",
        message: "This link is missing the verification token.",
      });
      return;
    }
    void (async () => {
      try {
        await authApi.confirmEmail(token);
        setVerifyState({ kind: "ok" });
        // If the user's auth context was sitting on the
        // login-pending screen waiting for verification, retry the
        // redeem proactively so a refresh isn't required.
        if (authState.kind === "pending") {
          await retryRedeem();
        }
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Verification failed";
        setVerifyState({ kind: "error", message });
      }
    })();
  }, [token, authApi, authState.kind, retryRedeem]);

  if (verifyState.kind === "verifying") {
    return (
      <AuthLayout title="Confirming your email…">
        <p className="text-sm text-tn-fg-muted">One moment.</p>
      </AuthLayout>
    );
  }
  if (verifyState.kind === "ok") {
    return (
      <AuthLayout title="Email confirmed">
        <p className="text-sm text-tn-fg">
          Your email address has been confirmed. You can now play online games.
        </p>
        <Button variant="primary" onClick={() => void navigate({ to: "/" })}>
          Continue
        </Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Could not confirm email">
      <p
        role="alert"
        className="border border-tn-red/50 bg-tn-red/10 px-3 py-2 text-sm text-tn-red"
      >
        {verifyState.message}
      </p>
      <Link
        to="/login"
        className="text-sm underline text-tn-fg hover:text-tn-blue"
      >
        Return to sign-in
      </Link>
    </AuthLayout>
  );
}
