/**
 * `/register` route — create a new account.
 *
 * The form posts to `POST /api/users` (via `useAuth().register`),
 * which always issues a refresh token and lands the user in either
 * `authenticated` (impossible at first registration but harmless to
 * support) or `pending` (the typical case: account is created
 * unactivated, so the access-token redemption fails and the user
 * sees the "verify your email" screen).
 *
 * The auth context also automatically triggers a verification email
 * after a successful register; the spec calls that out as the
 * frontend's job rather than the server's.
 *
 * Navigation happens directly in the submit handler from the `AuthState`
 * returned by `register`, so there is no reactive `useEffect` needed.
 * The route guard (`beforeLoad` in router.tsx) handles the case where
 * the user navigates here while already authenticated.
 */

import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../network/api";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { AuthLayout } from "./AuthLayout";

export function RegisterScreen() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const next = await register({ username, emailAddress, password });
      if (next.kind === "authenticated") void navigate({ to: "/" });
      else if (next.kind === "pending") void navigate({ to: "/login-pending" });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Registration failed",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Create your account">
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <TextField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
        <TextField
          label="Email address"
          type="email"
          value={emailAddress}
          onChange={(e) => setEmailAddress(e.target.value)}
          autoComplete="email"
          required
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
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
          disabled={
            submitting ||
            username.length < 2 ||
            emailAddress.length === 0 ||
            password.length < 8
          }
        >
          {submitting ? "Creating..." : "Create account"}
        </Button>
      </form>
      <p className="text-sm text-tn-fg-muted">
        Already have an account?{" "}
        <Link to="/login" className="underline hover:text-tn-blue">
          Sign in
        </Link>
        .
      </p>
    </AuthLayout>
  );
}
