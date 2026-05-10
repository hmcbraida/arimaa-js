/**
 * `/login` route -- username/email + password sign-in.
 *
 * On success we land in one of three places:
 *
 *   - `authenticated` -- navigate to the games tab.
 *   - `pending`       -- the account is unactivated or disabled;
 *                       navigate to the login-pending screen.
 *   - error           -- invalid credentials, etc. Render the error
 *                       above the form.
 *
 * Navigation happens directly in the submit handler from the `AuthState`
 * returned by `signIn`, so there is no reactive `useEffect` needed.
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

export function LoginScreen() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const next = await signIn({ usernameOrEmail, password });
      if (next.kind === "authenticated") void navigate({ to: "/" });
      else if (next.kind === "pending") void navigate({ to: "/login-pending" });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Sign in failed",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Sign in">
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <TextField
          label="Username or email"
          value={usernameOrEmail}
          onChange={(e) => setUsernameOrEmail(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
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
          disabled={submitting || password.length === 0}
        >
          {submitting ? "Signing in..." : "Sign in"}
        </Button>
      </form>
      <div className="flex justify-between text-sm text-tn-fg-muted">
        <Link to="/register" className="underline hover:text-tn-blue">
          Create account
        </Link>
        <Link to="/forgot-password" className="underline hover:text-tn-blue">
          Forgot password?
        </Link>
      </div>
    </AuthLayout>
  );
}
