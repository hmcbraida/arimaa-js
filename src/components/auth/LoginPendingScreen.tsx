/**
 * `/login-pending` route -- the user has a refresh token but the
 * server refuses to mint an access token because the account is in a
 * temporary or terminal not-allowed state.
 *
 * Two cases are handled:
 *
 *   - `account-not-activated` -- the user has not clicked the link in
 *     their verification email yet. We show the email address and a
 *     "Resend" button. After the user clicks the link in the email,
 *     they can return here and click "Try again" to retry the redeem
 *     and progress to the games tab.
 *
 *   - `account-disabled` -- administrative lock. We show a message and
 *     only the "Cancel sign-in" button (which clears the token).
 *
 * The "Cancel sign-in" button is the abort the user requested in the
 * spec -- clicking it logs them out and drops them back at `/login`.
 *
 * Navigation happens directly in action handlers from the `AuthState`
 * returned by `retryRedeem` / `cancelSignIn`.  The route guard
 * (`beforeLoad` in router.tsx) handles the case where the user
 * navigates here in the wrong state; the guard also fires after
 * `router.invalidate()` when auth resolves during `loading`.
 */

import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { useNetwork } from "../../network/useNetwork";
import { Button } from "../ui/Button";
import { AuthLayout } from "./AuthLayout";

export function LoginPendingScreen() {
  const { state, retryRedeem, cancelSignIn } = useAuth();
  const navigate = useNavigate();
  const { authApi } = useNetwork();
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resentNotice, setResentNotice] = useState(false);

  // Only meaningful in `pending` state.  During the initial `loading`
  // window (e.g. the user navigated here directly) show a neutral
  // message; the beforeLoad guard will redirect once auth resolves.
  if (state.kind !== "pending") {
    return (
      <AuthLayout title="One moment">
        <p className="text-sm text-tn-fg-muted">
          Checking your sign-in status…
        </p>
      </AuthLayout>
    );
  }

  const onResend = async () => {
    setResending(true);
    setResendError(null);
    setResentNotice(false);
    try {
      // The resend endpoint authenticates via the rt cookie -- no token
      // argument needed; the browser sends it automatically.
      await authApi.resendVerificationEmail();
      setResentNotice(true);
    } catch (err) {
      setResendError(err instanceof Error ? err.message : "Failed to resend");
    } finally {
      setResending(false);
    }
  };

  const onTryAgain = async () => {
    const next = await retryRedeem();
    if (next.kind === "authenticated") void navigate({ to: "/" });
    else if (next.kind === "anonymous") void navigate({ to: "/login" });
  };

  if (state.reason === "account-not-activated") {
    return (
      <AuthLayout
        title="Verify your email"
        subtitle={
          state.user !== null
            ? `We sent a verification link to ${state.user.emailAddress}.`
            : "We sent you a verification link."
        }
      >
        <p className="text-sm text-tn-fg">
          Click the link in the email, then come back here and select
          <em> Try again </em>
          to continue.
        </p>
        {resentNotice && (
          <p className="border border-tn-green/50 bg-tn-green/10 px-3 py-2 text-sm text-tn-fg">
            Verification email sent.
          </p>
        )}
        {resendError !== null && (
          <p className="border border-tn-red/50 bg-tn-red/10 px-3 py-2 text-sm text-tn-red">
            {resendError}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <Button variant="primary" onClick={onTryAgain}>
            Try again
          </Button>
          <Button onClick={onResend} disabled={resending}>
            {resending ? "Resending..." : "Resend verification email"}
          </Button>
          <Button
            onClick={async () => {
              await cancelSignIn();
              void navigate({ to: "/login" });
            }}
          >
            Cancel sign-in
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // account-disabled
  return (
    <AuthLayout title="Account disabled">
      <p className="text-sm text-tn-fg">
        This account has been disabled. If you believe this is a mistake, please
        contact support.
      </p>
      <Button
        variant="primary"
        onClick={async () => {
          await cancelSignIn();
          void navigate({ to: "/login" });
        }}
      >
        Cancel sign-in
      </Button>
    </AuthLayout>
  );
}
