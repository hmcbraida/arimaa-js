/**
 * Networked game view.
 *
 * The screen the user lands on after navigating to a session URL.
 * Owns:
 *
 * - A local `ArimaaGame` engine seeded from the server's transcript
 *   so the existing Board / ControllerPanel components can be reused
 *   without any API knowledge of their own.
 * - A live websocket subscription that replaces the local engine
 *   whenever the server publishes a new snapshot (opponent move,
 *   acceptance event, completion).
 * - Submit-turn interception: the user composes a move locally, but
 *   it is only committed once the server accepts it. Server rejection
 *   rolls the preview back so the engine and server stay in sync.
 * - A waiting banner that shows the accept code when the player is
 *   the creator and the opponent has not yet joined.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ArimaaGame, type MovementStep } from "../../game";
import { ApiError } from "../../network/api";
import { useNetwork } from "../../network/useNetwork";
import type { SessionSnapshot, Side } from "../../shared/schema";
import { Board } from "../Board";
import { ControllerPanel } from "../ControllerPanel";
import { shouldAdoptSnapshot } from "./snapshotAdoption";

interface NetworkGameViewProps {
  /** Latest server snapshot. Drives the initial engine state. */
  readonly initialSnapshot: SessionSnapshot;
}

function gameFromSnapshot(snapshot: SessionSnapshot): ArimaaGame {
  return ArimaaGame.fromTranscript(snapshot.transcript);
}

export function NetworkGameView({ initialSnapshot }: NetworkGameViewProps) {
  const { gameApi, socket } = useNetwork();
  const { state: authState, accessToken } = useAuth();
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(initialSnapshot);
  const [game, setGame] = useState<ArimaaGame>(() =>
    gameFromSnapshot(initialSnapshot),
  );

  // Bumped whenever the underlying engine instance is replaced so
  // the Board component (which is keyed on this) discards its
  // square-selection state.
  const [engineKey, setEngineKey] = useState(0);
  // Bumped after in-place mutations so snapshot-based children re-read.
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fetched from the server once per waiting period; null once redeemed.
  const [acceptToken, setAcceptToken] = useState<string | null>(null);

  // Spectators can toggle the board orientation; players are locked to their side.
  const [spectatorFlipped, setSpectatorFlipped] = useState(false);

  /**
   * Determine the viewer's side, if any. We compare the auth context
   * user id against the snapshot participants, which is the
   * server-truth ownership record. An anonymous viewer or an
   * authenticated user who is not on this game has `viewerSide ===
   * null`.
   */
  const viewerSide: Side | null = useMemo(() => {
    if (authState.kind !== "authenticated") return null;
    const userId = authState.user.id;
    if (snapshot.participants.gold?.userId === userId) return "gold";
    if (snapshot.participants.silver?.userId === userId) return "silver";
    return null;
  }, [authState, snapshot.participants]);

  // We keep a ref to the latest snapshot so the websocket effect can
  // read it without re-subscribing on every snapshot change.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const adoptSnapshot = useCallback((next: SessionSnapshot) => {
    setSnapshot(next);
    setGame(gameFromSnapshot(next));
    setEngineKey((k) => k + 1);
  }, []);

  /**
   * Subscribe to the session's event stream. We re-subscribe if the
   * session id ever changes (e.g. user navigates between games via
   * the table without unmounting this view).
   */
  useEffect(() => {
    const unsubscribe = socket.subscribe(initialSnapshot.id, (event) => {
      const incomingSnapshot =
        event.type === "completed" ||
        event.type === "move" ||
        event.type === "accepted"
          ? event.snapshot
          : null;
      if (incomingSnapshot === null) return;
      if (!shouldAdoptSnapshot(incomingSnapshot, snapshotRef.current)) {
        return;
      }
      adoptSnapshot(incomingSnapshot);
    });
    return () => {
      unsubscribe();
    };
  }, [initialSnapshot.id, socket, adoptSnapshot]);

  // Fetch the accept token whenever this session is in the waiting state
  // and the viewer is a participant. Clears when the game starts.
  useEffect(() => {
    const at = accessToken();
    if (snapshot.status !== "waiting" || viewerSide === null || at === null) {
      setAcceptToken(null);
      return;
    }
    let cancelled = false;
    gameApi
      .getSessionAcceptToken({ accessToken: at, sessionId: snapshot.id })
      .then((res) => {
        if (!cancelled) setAcceptToken(res.acceptToken);
      })
      .catch(() => {
        // Non-fatal -- the banner just won't show a code.
      });
    return () => {
      cancelled = true;
    };
  }, [gameApi, accessToken, snapshot.id, snapshot.status, viewerSide]);

  const myTurn = viewerSide !== null && snapshot.sideToMove === viewerSide;
  const spectator = viewerSide === null;
  const flipped = spectator ? spectatorFlipped : viewerSide === "silver";

  const onStep = useCallback(
    (step: MovementStep) => {
      if (!myTurn) return;
      game.executeKnownLegalStep(step);
      refresh();
    },
    [game, myTurn, refresh],
  );

  const onUndoVisibleStep = useCallback(() => {
    if (!myTurn) return;
    if (game.undoVisibleStep()) refresh();
  }, [game, myTurn, refresh]);

  /**
   * Submit the current preview to the server.
   */
  const onSubmitTurn = useCallback(async () => {
    const at = accessToken();
    if (at === null || !myTurn || submitting) return;

    const currentSteps = game.getCurrentMoveSteps();
    if (currentSteps.length === 0) return;

    const moveNotation = currentSteps
      .flatMap((step) => step.notationEntries)
      .join(" ");

    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await gameApi.submitMove({
        accessToken: at,
        sessionId: snapshot.id,
        body: { moveNotation },
      });
      adoptSnapshot(response.snapshot);
    } catch (error) {
      // Roll the preview steps back so the local engine matches the
      // server's still-current view of the position.
      while (game.undoVisibleStep()) {
        // Loop body intentionally empty --  undoVisibleStep returns
        // false when there is nothing left to undo.
      }
      refresh();
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Failed to submit move";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }, [
    gameApi,
    accessToken,
    snapshot.id,
    myTurn,
    submitting,
    game,
    adoptSnapshot,
    refresh,
  ]);

  /**
   * Forward export and import requests to the engine. Import is a
   * destructive replace; in networked play it would desynchronise
   * from the server, so we silently ignore it. The controller panel
   * still exposes the buttons for a consistent feel.
   */
  const onExportTranscript = useCallback(() => game.toTranscript(), [game]);
  const onImportTranscript = useCallback(() => {
    // Intentional no-op in network mode.
  }, []);

  const showWaitingBanner = snapshot.status === "waiting";

  return (
    <section className="flex flex-col gap-6">
      {showWaitingBanner && (
        <div className="border border-tn-yellow/50 bg-tn-yellow/10 p-4 text-sm text-tn-fg">
          {viewerSide !== null && acceptToken !== null ? (
            <>
              Waiting for opponent. Share this code:{" "}
              <span className="font-mono font-bold tracking-widest">
                {acceptToken}
              </span>
            </>
          ) : (
            "Waiting for opponent."
          )}
        </div>
      )}
      {snapshot.status === "completed" && (
        <div className="border border-tn-border bg-tn-surface p-4 text-sm text-tn-fg">
          Game finished -- {snapshot.winner === "gold" ? "Gold" : "Silver"} won
          ({snapshot.reason}).
        </div>
      )}
      {spectator && (
        <div className="flex items-center justify-between gap-4 border border-tn-border bg-tn-panel p-4 text-sm text-tn-fg-muted">
          <span>You are spectating this game. Moves are read-only.</span>
          <button
            className="whitespace-nowrap bg-tn-overlay px-3 py-1 text-xs text-tn-fg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-tn-blue"
            style={{
              boxShadow: "0 -1px 0 0 rgba(255,255,255,0.04), 0 3px 0 0 #0f1017",
            }}
            onClick={() => setSpectatorFlipped((f) => !f)}
            type="button"
          >
            {spectatorFlipped ? "View as Gold" : "View as Silver"}
          </button>
        </div>
      )}
      {submitError !== null && (
        <div className="border border-tn-red/50 bg-tn-red/10 p-4 text-sm text-tn-fg">
          {submitError}
        </div>
      )}

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <Board
          key={engineKey}
          game={game}
          revision={revision}
          flipped={flipped}
          onStep={spectator ? () => undefined : onStep}
          onUndoVisibleStep={spectator ? () => undefined : onUndoVisibleStep}
        />
        <ControllerPanel
          game={game}
          onExportTranscript={onExportTranscript}
          onImportTranscript={onImportTranscript}
          onSubmitTurn={() => void onSubmitTurn()}
          onUndoVisibleStep={spectator ? () => undefined : onUndoVisibleStep}
        />
      </div>
    </section>
  );
}
