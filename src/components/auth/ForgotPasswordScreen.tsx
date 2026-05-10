/**
 * `/forgot-password` route -- request a password-reset email.
 *
 * The endpoint is silent on whether the email exists, so the success
 * message is non-committal: "If an account exists for that address,
 * we have sent a reset link." We never confirm or deny.
 */

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError } from "../../network/api";
import { useNetwork } from "../../network/useNetwork";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { AuthLayout } from "./AuthLayout";

export function ForgotPasswordScreen() {
  const { authApi } = useNetwork();
  const [emailAddress, setEmailAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await authApi.requestPasswordReset({ emailAddress });
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not request reset",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <AuthLayout
        title="Check your inbox"
        subtitle="If an account exists for that address, we have sent a reset link."
      >
        <Link
          to="/login"
          className="text-sm underline text-tn-fg hover:text-tn-blue"
        >
          Return to sign-in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a one-time link to choose a new password."
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <TextField
          label="Email address"
          type="email"
          value={emailAddress}
          onChange={(e) => setEmailAddress(e.target.value)}
          autoComplete="email"
          required
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
          disabled={submitting || emailAddress.length === 0}
        >
          {submitting ? "Sending..." : "Send reset link"}
        </Button>
      </form>
      <Link
        to="/login"
        className="text-sm underline text-tn-fg hover:text-tn-blue"
      >
        Back to sign-in
      </Link>
    </AuthLayout>
  );
}
