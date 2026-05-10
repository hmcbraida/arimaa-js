/**
 * `/preferences` route.
 *
 * Renders the authenticated user's profile (read-only for now —
 * editing fields are not yet in scope) plus a Delete Account button
 * which spawns a confirmation modal. On confirmation we call
 * `DELETE /api/users/me` and sign the user out.
 */

import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import { ApiError } from "../network/api";
import { useNetwork } from "../network/useNetwork";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";

export function PreferencesPage() {
  const { state, signOut, accessToken } = useAuth();
  const { authApi } = useNetwork();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.kind !== "authenticated") {
    // Should never happen because the route is gated, but render
    // gracefully if it does (e.g. a deep link).
    return (
      <p className="text-sm text-tn-fg-muted">Sign in to manage preferences.</p>
    );
  }

  const onDelete = async () => {
    const at = accessToken();
    if (at === null) return;
    setDeleting(true);
    setError(null);
    try {
      await authApi.deleteAccount(at);
      await signOut();
      void navigate({ to: "/" });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not delete account",
      );
    } finally {
      setDeleting(false);
    }
  };

  const profile = state.user;
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl text-tn-fg">Preferences</h2>
        <p className="text-sm text-tn-fg-muted">
          Profile information: {profile.username}.
        </p>
      </header>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-tn-fg-muted">Username</dt>
        <dd className="text-tn-fg">{profile.username}</dd>
        <dt className="text-tn-fg-muted">Email</dt>
        <dd className="text-tn-fg">{profile.emailAddress}</dd>
        <dt className="text-tn-fg-muted">Joined</dt>
        <dd className="text-tn-fg">
          {new Date(profile.rCreated).toLocaleString()}
        </dd>
        <dt className="text-tn-fg-muted">Last sign-in</dt>
        <dd className="text-tn-fg">
          {profile.lastLogin === null
            ? "Never"
            : new Date(profile.lastLogin).toLocaleString()}
        </dd>
      </dl>

      <hr className="border-tn-border" />

      <div className="flex flex-col gap-2">
        <h3 className="text-sm uppercase tracking-wide text-tn-fg-muted">
          Danger zone
        </h3>
        <Button onClick={() => setConfirmOpen(true)}>
          <span className="text-tn-red">Delete account</span>
        </Button>
        {error !== null && (
          <p
            role="alert"
            className="border border-tn-red/50 bg-tn-red/10 px-3 py-2 text-sm text-tn-red"
          >
            {error}
          </p>
        )}
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Delete your account?"
      >
        <p className="text-sm text-tn-fg">
          This will permanently delete your Arimaatic account. Your past games
          remain visible to other players, but will no longer be tied to your
          user.
        </p>
        <p className="text-sm text-tn-fg-muted">
          This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirmOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onDelete}
            disabled={deleting}
            // Inline override: red destructive variant.
            style={{
              boxShadow: "0 -1px 0 0 rgba(255,255,255,0.12), 0 3px 0 0 #993939",
            }}
            className="bg-tn-red text-tn-bg hover:opacity-90"
          >
            {deleting ? "Deleting..." : "Delete account"}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
