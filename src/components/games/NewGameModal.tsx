/**
 * Modal that lets the user start a new game.
 *
 * The user chooses a side (gold or silver). On submit we call
 * `api.createSession`, persist the resulting credentials in
 * localStorage, and navigate to the new session's URL.
 *
 * The component takes a `onCreated` callback rather than calling
 * `useNavigate` directly so it stays decoupled from the router; the
 * games tab wires the navigation.
 */

import { useState } from "react";
import { upsertStoredGame } from "../../network/storage";
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
  const { api } = useNetwork();
  const [side, setSide] = useState<Side>("gold");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createSession(side);
      // Persist the secret so later visits to the same URL still
      // recognise this browser as a player. Persist the accept token
      // so the games table can show "share this code" to the creator.
      upsertStoredGame({
        sessionId: created.sessionId,
        role: "player",
        side: created.side,
        secretToken: created.secretToken,
        acceptToken: created.acceptToken,
        addedAt: new Date().toISOString(),
      });
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
      <fieldset
        className="flex gap-3"
        // Disabled while in-flight so double-submits are impossible.
        disabled={submitting}
      >
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
