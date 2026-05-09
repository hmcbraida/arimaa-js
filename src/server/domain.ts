/**
 * Pure domain logic for Arimaa game sessions.
 *
 * This module is the bridge between the API surface and the existing Arimaa
 * rules engine. It is deliberately I/O free: no database, no network, no
 * filesystem. The Fastify handlers compose these helpers with the persistence
 * and event-bus adapters to deliver each endpoint's behavior.
 *
 * The two key concepts here are:
 *
 * - **Stored transcript**: the canonical game state, in the same long-form
 *   transcript format the existing engine round-trips through. The server
 *   never persists a compiled board; it persists the transcript and replays
 *   it through `ArimaaGame.fromTranscript` on demand. This gives us free
 *   integrity checking (the engine refuses to load a malformed transcript)
 *   and a small, human-inspectable column in the database.
 *
 * - **Session status**: a four-state lifecycle that combines the engine's
 *   own status with whether the second player has accepted the invitation.
 */

import { ArimaaGame, Side } from "../game";
import type { GameStatus } from "../game";
import type {
  GameOutcomeReason,
  SessionMoveLogEntry,
  SessionSnapshot,
  SessionStatus,
} from "../shared/schema";
import type { Side as WireSide } from "../shared/schema";

/* --------------------------------------------------------------------- */
/* Side conversion                                                       */
/* --------------------------------------------------------------------- */

/**
 * Convert the engine's `Side` enum into the wire string representation.
 *
 * Both representations use the same string values, but funnelling through a
 * helper keeps the engine import isolated to this module instead of bleeding
 * into the route handlers.
 */
export function engineSideToWire(side: Side): WireSide {
  return side === Side.Gold ? "gold" : "silver";
}

/**
 * Convert a wire-format side back into the engine's enum value.
 */
export function wireSideToEngine(side: WireSide): Side {
  return side === "gold" ? Side.Gold : Side.Silver;
}

/* --------------------------------------------------------------------- */
/* Initial session state                                                 */
/* --------------------------------------------------------------------- */

/**
 * Produce a transcript representing a fresh game with the default Arimaa
 * setup, before any move has been made.
 *
 * The first iteration of this product does not allow custom setups, so this
 * is the only starting position the server ever generates.
 */
export function createInitialTranscript(): string {
  return ArimaaGame.withDefaultSetup().toTranscript();
}

/* --------------------------------------------------------------------- */
/* Snapshot derivation                                                   */
/* --------------------------------------------------------------------- */

/**
 * Translate the engine's `GameStatus` into the (winner, reason) pair used in
 * the wire snapshot.
 */
function unpackEngineStatus(status: GameStatus): {
  winner: WireSide | null;
  reason: GameOutcomeReason | null;
} {
  if (status.kind === "finished") {
    return { winner: engineSideToWire(status.winner), reason: status.reason };
  }
  return { winner: null, reason: null };
}

/**
 * Compute the session-level status from the engine's status plus whether the
 * waiting flag is currently set.
 *
 * The session is in `waiting` status from creation up until the second player
 * accepts; after that, it tracks the engine's perspective on whose turn it is
 * (or the completion state).
 */
export function deriveSessionStatus(
  engine: ArimaaGame,
  hasOpponent: boolean,
): SessionStatus {
  if (!hasOpponent) {
    return "waiting";
  }
  const snapshot = engine.getSnapshot();
  if (snapshot.status.kind === "finished") {
    return "completed";
  }
  return engineSideToWire(snapshot.sideToMove);
}

/**
 * Build a public session snapshot from the persisted record.
 *
 * The caller supplies the database-level fields (id, timestamps, transcript,
 * has-opponent flag). This helper handles the engine replay and the
 * status/winner/reason derivation.
 */
export function buildSessionSnapshot(args: {
  id: string;
  transcript: string;
  hasOpponent: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SessionSnapshot {
  const engine = ArimaaGame.fromTranscript(args.transcript);
  const snapshot = engine.getSnapshot();
  const status = deriveSessionStatus(engine, args.hasOpponent);
  const { winner, reason } = unpackEngineStatus(snapshot.status);

  /**
   * `sideToMove` is whose turn it is right now, observable to the public.
   * It is null while we are waiting for an opponent (because the game has
   * not started) and after completion (no further moves are accepted).
   */
  const sideToMove =
    status === "gold" ? "gold" : status === "silver" ? "silver" : null;

  return {
    id: args.id,
    status,
    sideToMove,
    transcript: args.transcript,
    moveLog: engine.getMoveLog().map(
      (move): SessionMoveLogEntry => ({
        moveNumber: move.moveNumber,
        side: engineSideToWire(move.side),
        notation: move.notation,
      }),
    ),
    winner,
    reason,
    createdAt: args.createdAt.toISOString(),
    updatedAt: args.updatedAt.toISOString(),
  };
}

/* --------------------------------------------------------------------- */
/* Move application                                                      */
/* --------------------------------------------------------------------- */

/**
 * Result of attempting to apply a move to a stored transcript.
 *
 * The error is a discriminated value rather than a thrown exception so the
 * route handler can map each cause to a precise HTTP status code without
 * inspecting error messages.
 */
export type ApplyMoveResult =
  | { ok: true; transcript: string; engine: ArimaaGame }
  | { ok: false; reason: "wrong-turn" | "game-over" | "invalid-move" };

/**
 * Append a move (in long Arimaa notation) to a transcript.
 *
 * We build the candidate transcript by replacing the trailing turn-label-only
 * line (which `toTranscript` always emits) with `${label} ${moveNotation}`.
 * The full string is then handed to `ArimaaGame.fromTranscript`, which
 * performs a complete legality check by re-replaying every move from setup.
 *
 * Re-replaying from scratch is computationally cheap relative to the network
 * round-trip and gives us strong guarantees: there is no possible drift
 * between the persisted transcript and any in-memory cached state, because
 * we never keep an in-memory cached state.
 */
export function applyMoveToTranscript(
  transcript: string,
  moveNotation: string,
  expectedSide: WireSide,
): ApplyMoveResult {
  const engine = ArimaaGame.fromTranscript(transcript);
  const snapshot = engine.getSnapshot();

  // Reject moves submitted to a finished game outright. This avoids leaking
  // engine error messages and gives the API a clean rejection reason.
  if (snapshot.status.kind === "finished") {
    return { ok: false, reason: "game-over" };
  }

  // Reject moves submitted when it is not the player's turn.
  if (engineSideToWire(snapshot.sideToMove) !== expectedSide) {
    return { ok: false, reason: "wrong-turn" };
  }

  /**
   * The transcript ends with a label-only line (e.g. "2g") emitted by
   * `toTranscript`. To append a move we replace that label with the same
   * label followed by the move tokens. We trim defensively so that
   * accidental trailing whitespace from prior writes doesn't break parsing.
   */
  const lines = transcript.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) {
    lines.pop();
  }
  const trailingLabel = lines[lines.length - 1].trim();

  // The trailing label is a token like "2g" with no whitespace inside it. If
  // for any reason it already contains move tokens, treat the transcript as
  // structurally invalid rather than silently producing a corrupt result.
  if (/\s/.test(trailingLabel)) {
    return { ok: false, reason: "invalid-move" };
  }

  const moveLine = `${trailingLabel} ${moveNotation.trim()}`;
  const candidate = [...lines.slice(0, -1), moveLine].join("\n");

  // The engine throws if the move notation cannot be replayed. We catch and
  // map to a single coarse `invalid-move` reason; richer client-side error
  // messages are not necessary for this iteration.
  try {
    const updated = ArimaaGame.fromTranscript(candidate);
    return { ok: true, transcript: updated.toTranscript(), engine: updated };
  } catch {
    return { ok: false, reason: "invalid-move" };
  }
}
