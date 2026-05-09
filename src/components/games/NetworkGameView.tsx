/**
 * Networked game view.
 *
 * This is the screen the user lands on after joining or creating a
 * game. It owns:
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
 *
 * The component is deliberately not hooked into TanStack Router; the
 * route component (`NetworkGameTab`) handles routing concerns and
 * passes down the resolved snapshot.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArimaaGame, type MovementStep } from "../../game";
import { ApiError } from "../../network/api";
import { type StoredGame, upsertStoredGame } from "../../network/storage";
import { useNetwork } from "../../network/useNetwork";
import type { SessionSnapshot } from "../../shared/schema";
import { Board } from "../Board";
import { ControllerPanel } from "../ControllerPanel";

interface NetworkGameViewProps {
  /** Latest server snapshot. Drives the initial engine state. */
  readonly initialSnapshot: SessionSnapshot;
  /** Stored credential record, if the viewer is a player on this session. */
  readonly stored: StoredGame | null;
}

/**
 * Build a fresh ArimaaGame from a session snapshot.
 *
 * Pulled out into a helper because it is called in three places
 * (initial mount, after server submit, after a websocket event) and
 * inlining it three times invites bugs.
 */
function gameFromSnapshot(snapshot: SessionSnapshot): ArimaaGame {
  return ArimaaGame.fromTranscript(snapshot.transcript);
}

export function NetworkGameView({
  initialSnapshot,
  stored,
}: NetworkGameViewProps) {
  const { api, socket } = useNetwork();
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

  // Spectators can toggle the board orientation; players are locked to their side.
  const [spectatorFlipped, setSpectatorFlipped] = useState(false);

  // We keep a ref to the latest snapshot so the websocket effect can
  // read it without re-subscribing on every snapshot change.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  /**
   * Replace the engine with a fresh one synthesised from `next`, and
   * remember the new snapshot. Done together so the component's view
   * of "server truth" and "engine state" never drift.
   */
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
      // All event payloads include the latest snapshot, so we can
      // adopt it uniformly regardless of event type. We only do so
      // if the new transcript is actually different — otherwise we
      // pointlessly discard the user's in-progress preview.
      const incomingSnapshot =
        event.type === "completed" ||
        event.type === "move" ||
        event.type === "accepted"
          ? event.snapshot
          : null;
      if (incomingSnapshot === null) return;
      if (incomingSnapshot.transcript === snapshotRef.current.transcript) {
        return;
      }
      adoptSnapshot(incomingSnapshot);
    });
    return () => {
      unsubscribe();
    };
  }, [initialSnapshot.id, socket, adoptSnapshot]);

  /**
   * Whose move is it? Used to disable the controller for the player
   * whose turn it is not.
   */
  const myTurn = useMemo(() => {
    if (stored === null || stored.side === null) return false;
    return snapshot.sideToMove === stored.side;
  }, [snapshot.sideToMove, stored]);

  /**
   * Is the current viewer just spectating?
   */
  const spectator = stored === null || stored.role !== "player";

  /**
   * Board orientation. Silver players always see a flipped board (rank 1 at
   * top). Spectators start with the gold perspective but can toggle. Gold
   * players always see the normal orientation.
   */
  const flipped = spectator ? spectatorFlipped : stored?.side === "silver";

  /**
   * Forward a step to the engine. We allow this only if the viewer
   * holds the credential for the side currently to move. Spectators
   * see a read-only board.
   */
  const onStep = useCallback(
    (step: MovementStep) => {
      if (!myTurn) return;
      game.executeKnownLegalStep(step);
      refresh();
    },
    [game, myTurn, refresh],
  );

  /**
   * Undo the latest visible step. Allowed only while the viewer is
   * actively composing their own move; we do not roll back a
   * server-confirmed move.
   */
  const onUndoVisibleStep = useCallback(() => {
    if (!myTurn) return;
    if (game.undoVisibleStep()) refresh();
  }, [game, myTurn, refresh]);

  /**
   * Submit the current preview to the server.
   *
   * We compose the move notation from the engine's currentMoveSteps
   * field — exactly the same way the engine builds a finished move
   * notation internally. Posting that string to the server is the
   * single source of legality truth; if the server accepts, we adopt
   * the new snapshot and discard the preview, if it rejects, we roll
   * the preview back to keep our state aligned with the server's.
   */
  const onSubmitTurn = useCallback(async () => {
    if (stored === null || stored.secretToken === null) return;
    if (!myTurn || submitting) return;

    const currentSteps = game.getCurrentMoveSteps();
    if (currentSteps.length === 0) return;

    const moveNotation = currentSteps
      .flatMap((step) => step.notationEntries)
      .join(" ");

    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await api.submitMove({
        sessionId: snapshot.id,
        secretToken: stored.secretToken,
        body: { moveNotation },
      });
      adoptSnapshot(response.snapshot);
    } catch (error) {
      // Roll the preview steps back so the local engine matches the
      // server's still-current view of the position.
      while (game.undoVisibleStep()) {
        // Loop body intentionally empty — undoVisibleStep returns
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
    api,
    snapshot.id,
    stored,
    myTurn,
    submitting,
    game,
    adoptSnapshot,
    refresh,
  ]);

  /**
   * Forward export and import requests to the engine.
   *
   * Export is read-only; import is a destructive replace, but in
   * networked play it would desynchronise from the server, so we
   * disable it by ignoring the call. The controller panel still
   * exposes the buttons for a consistent feel; clicking import in
   * networked mode simply does nothing useful.
   */
  const onExportTranscript = useCallback(() => game.toTranscript(), [game]);
  const onImportTranscript = useCallback(() => {
    // Intentional no-op in network mode.
  }, []);

  /**
   * If the viewer is the creator of a still-waiting game, store the
   * latest snapshot so the games-table can display the accept code.
   * Also, the creator may have opened the page directly (e.g. they
   * shared the URL with themselves) and the `acceptToken` is stored
   * in localStorage from when they created the session.
   */
  const acceptCode =
    snapshot.status === "waiting" && stored !== null
      ? stored.acceptToken
      : null;

  /**
   * On every fresh snapshot, persist the most recent role/side back
   * to localStorage so subsequent renders reflect the truth.
   */
  useEffect(() => {
    if (stored === null) return;
    upsertStoredGame({
      ...stored,
      // If the game has finished, drop the accept token because it's
      // no longer meaningful. (It would already have been cleared
      // server-side by acceptance, but defensive cleanup is cheap.)
      acceptToken: snapshot.status === "completed" ? null : stored.acceptToken,
      addedAt: stored.addedAt,
    });
  }, [snapshot.status, stored]);

  return (
    <section className="flex flex-col gap-6">
      {acceptCode !== null && (
        <div className="border border-amber-500 bg-amber-50 p-4 text-sm text-amber-900">
          <strong className="font-semibold">Waiting for opponent.</strong> Share
          this code with your opponent so they can join:{" "}
          <span className="font-mono text-base font-bold">{acceptCode}</span>
        </div>
      )}
      {snapshot.status === "completed" && (
        <div className="border border-stone-500 bg-stone-100 p-4 text-sm text-stone-900">
          Game finished — {snapshot.winner === "gold" ? "Gold" : "Silver"} won (
          {snapshot.reason}).
        </div>
      )}
      {/* Role / perspective indicator */}
      {!spectator && stored?.side === "gold" && (
        <div className="border border-amber-400 bg-amber-50 p-4 text-sm font-medium text-amber-900">
          You are playing Gold.
        </div>
      )}
      {!spectator && stored?.side === "silver" && (
        <div className="border border-stone-400 bg-stone-100 p-4 text-sm font-medium text-stone-800">
          You are playing Silver.
        </div>
      )}
      {spectator && (
        <div className="flex items-center justify-between gap-4 border border-stone-300 bg-stone-50 p-4 text-sm text-stone-700">
          <span>You are spectating this game. Moves are read-only.</span>
          <button
            className="whitespace-nowrap rounded border border-stone-400 bg-white px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-500"
            onClick={() => setSpectatorFlipped((f) => !f)}
            type="button"
          >
            {spectatorFlipped ? "View as Gold" : "View as Silver"}
          </button>
        </div>
      )}
      {submitError !== null && (
        <div className="border border-rose-500 bg-rose-50 p-4 text-sm text-rose-900">
          {submitError}
        </div>
      )}

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <Board
          // Re-keying on engineKey discards the Board's square-selection
          // state when the engine is replaced from a server update.
          key={engineKey}
          game={game}
          revision={revision}
          flipped={flipped}
          // Spectators and the off-turn player still see legal-move
          // dots highlighted, but their clicks are dropped because
          // the engine refuses any moves the side-to-move can't make.
          // We additionally short-circuit at the prop level to keep
          // a clear audit trail in the component tree.
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
