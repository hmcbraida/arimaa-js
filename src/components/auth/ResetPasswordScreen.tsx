/**
 * `/reset-password` route — destination for the link in the
 * password-reset email. The token comes from `?token=…`.
 *
 * On submit we POST to `/api/passwords/resets/{token}` with the new
 * password. Success transitions to a "Done" state with a link back
 * to sign-in; failure surfaces the server message inline.
 */

import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError } from "../../network/api";
import { useNetwork } from "../../network/useNetwork";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { AuthLayout } from "./AuthLayout";

export function ResetPasswordScreen() {
  const navigate = useNavigate();
  const { authApi } = useNetwork();
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await authApi.completePasswordReset(token, { newPassword });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not reset password",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (token.length === 0) {
    return (
      <AuthLayout title="Invalid reset link">
        <p className="text-sm text-tn-fg-muted">
          This link is missing the reset token. Request a new one to continue.
        </p>
        <Link
          to="/forgot-password"
          className="text-sm underline text-tn-fg hover:text-tn-blue"
        >
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout
        title="Password updated"
        subtitle="Sign in with your new password to continue."
      >
        <Button
          variant="primary"
          onClick={() => void navigate({ to: "/login" })}
        >
          Go to sign-in
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <TextField
          label="New password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
          autoFocus
          hint="At least eight characters."
        />
        {error !== null && (
          <p
            role="alert"
            className="border border-tn-red/50 bg-tn-red/10 px-3 py-2 text-sm text-tn-red"
          >
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={submitting || newPassword.length < 8}
        >
          {submitting ? "Saving..." : "Set new password"}
        </Button>
      </form>
    </AuthLayout>
  );
}
