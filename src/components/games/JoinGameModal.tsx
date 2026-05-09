/**
 * Modal that lets the user join an existing game by entering an
 * 8-digit accept code.
 *
 * On submit we call `api.acceptSession` with the code; on success the
 * server returns the session id, our assigned side, and a freshly
 * minted secret token. We persist the credentials and notify the
 * parent so it can navigate to the joined game.
 */

import { useState } from "react";
import { upsertStoredGame } from "../../network/storage";
import { useNetwork } from "../../network/useNetwork";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { TextField } from "../ui/TextField";

interface JoinGameModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onJoined: (sessionId: string) => void;
}

export function JoinGameModal({ open, onClose, onJoined }: JoinGameModalProps) {
  const { api } = useNetwork();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validation message that shows beneath the input. We surface it
  // inline rather than blocking submit so the user gets immediate
  // feedback without being trapped behind a disabled button.
  const validationHint =
    code.length === 0
      ? "Eight-digit code from your opponent"
      : /^\d{8}$/.test(code)
        ? undefined
        : "Code must be exactly eight digits";

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const accepted = await api.acceptSession({ acceptToken: code });
      upsertStoredGame({
        sessionId: accepted.sessionId,
        role: "player",
        side: accepted.side,
        secretToken: accepted.secretToken,
        // Joined players never have an accept token of their own to
        // share — that field is only meaningful for the creator.
        acceptToken: null,
        addedAt: new Date().toISOString(),
      });
      onJoined(accepted.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join game");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Join a game">
      <TextField
        label="Game code"
        value={code}
        // We allow only digits and clamp to eight characters so the
        // accept-code format is enforced as the user types.
        onChange={(event) =>
          setCode(event.target.value.replace(/\D/g, "").slice(0, 8))
        }
        hint={validationHint}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
      />
      {error !== null && <p className="text-sm text-tn-red">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={onSubmit}
          disabled={submitting || !/^\d{8}$/.test(code)}
        >
          {submitting ? "Joining..." : "Join"}
        </Button>
      </div>
    </Modal>
  );
}
