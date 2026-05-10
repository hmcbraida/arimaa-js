/**
 * Modal that lets an authenticated user join an existing game by
 * entering the 8-digit accept code shared by the creator.
 *
 * On success the parent component navigates to `/sessions/:id`. We do
 * not persist anything client-side — the user's relationship to the
 * session is now stored server-side in the gold/silver user-id
 * columns, and the games list will pick it up on next reload.
 */

import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
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
  const { gameApi } = useNetwork();
  const { accessToken } = useAuth();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validationHint =
    code.length === 0
      ? "Eight-digit code from your opponent"
      : /^\d{8}$/.test(code)
        ? undefined
        : "Code must be exactly eight digits";

  const onSubmit = async () => {
    const at = accessToken();
    if (at === null) {
      setError("You must be signed in to join a game.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const accepted = await gameApi.acceptSession({
        accessToken: at,
        body: { acceptToken: code },
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
