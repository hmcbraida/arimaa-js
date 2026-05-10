/**
 * Modal that lets the authenticated user start a new game.
 *
 * The user chooses a side. On submit we call
 * `gameApi.createSession` with their access token; on success the
 * server responds with the eight-digit accept code (which the creator
 * must share with their opponent) and the session id, which we hand
 * back to the parent so it can navigate.
 */

import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { useNetwork } from "../../network/useNetwork";
import type { Side } from "../../shared/schema";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

interface NewGameModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (sessionId: string) => void;
}

export function NewGameModal({ open, onClose, onCreated }: NewGameModalProps) {
  const { gameApi } = useNetwork();
  const { accessToken } = useAuth();
  const [side, setSide] = useState<Side>("gold");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    const at = accessToken();
    if (at === null) {
      setError("You must be signed in to create a game.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await gameApi.createSession({ accessToken: at, side });
      onCreated(created.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create game");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Start a new game">
      <p className="text-sm text-tn-fg-muted">
        Choose your side. You will get an 8-digit code to share with your
        opponent so they can join.
      </p>
      <fieldset className="flex gap-3" disabled={submitting}>
        <legend className="sr-only">Side</legend>
        {(["gold", "silver"] as const).map((option) => (
          <label
            key={option}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-2 px-3 py-2 text-sm ${
              side === option
                ? "bg-tn-blue text-tn-bg"
                : "bg-tn-overlay text-tn-fg"
            }`}
            style={{
              boxShadow:
                side === option
                  ? "0 -1px 0 0 rgba(255,255,255,0.12), 0 3px 0 0 #3d59a1"
                  : "0 -1px 0 0 rgba(255,255,255,0.04), 0 3px 0 0 #0f1017",
            }}
          >
            <input
              type="radio"
              name="side"
              value={option}
              checked={side === option}
              onChange={() => setSide(option)}
              className="sr-only"
            />
            {option[0].toUpperCase() + option.slice(1)}
          </label>
        ))}
      </fieldset>
      {error !== null && <p className="text-sm text-tn-red">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onSubmit} disabled={submitting}>
          {submitting ? "Creating..." : "Create game"}
        </Button>
      </div>
    </Modal>
  );
}
