/**
 * Pure domain logic for Arimaa game sessions.
 *
 * This module is the bridge between the API surface and the existing
 * Arimaa rules engine. It is deliberately I/O free: no database, no
 * network, no filesystem. The Fastify handlers compose these helpers
 * with the persistence and event-bus adapters to deliver each
 * endpoint's behavior.
 *
 * The two key concepts here are:
 *
 * - **Stored transcript**: the canonical game state, in the same
 *   long-form transcript format the existing engine round-trips
 *   through. The server never persists a compiled board; it persists
 *   the transcript and replays it through `ArimaaGame.fromTranscript`
 *   on demand.
 *
 * - **Session status**: a four-state lifecycle that combines the
 *   engine's own status with whether the second player has joined.
 */

import { ArimaaGame, Side } from "../game";
import type { GameStatus } from "../game";
import type {
  GameOutcomeReason,
  SessionListEntry,
  SessionMoveLogEntry,
  SessionParticipant,
  SessionSnapshot,
  SessionStatus,
} from "../shared/schema";
import type { Side as WireSide } from "../shared/schema";
import type { SessionRecord, UserRecord } from "./persistence/store";

/* --------------------------------------------------------------------- */
/* Side conversion                                                       */
/* --------------------------------------------------------------------- */

export function engineSideToWire(side: Side): WireSide {
  return side === Side.Gold ? "gold" : "silver";
}

export function wireSideToEngine(side: WireSide): Side {
  return side === "gold" ? Side.Gold : Side.Silver;
}

/* --------------------------------------------------------------------- */
/* Initial session state                                                 */
/* --------------------------------------------------------------------- */

export function createInitialTranscript(): string {
  return ArimaaGame.withDefaultSetup().toTranscript();
}

/* --------------------------------------------------------------------- */
/* Snapshot derivation                                                   */
/* --------------------------------------------------------------------- */

function unpackEngineStatus(status: GameStatus): {
  winner: WireSide | null;
  reason: GameOutcomeReason | null;
} {
  if (status.kind === "finished") {
    return { winner: engineSideToWire(status.winner), reason: status.reason };
  }
  return { winner: null, reason: null };
}

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
 * Translate a `UserRecord` (or null) into the participant shape the
 * wire snapshot exposes. We deliberately surface only id and username
 * — never email, never any flag — because spectators of a game can
 * read this snapshot.
 */
export function userRecordToParticipant(
  user: UserRecord | null,
): SessionParticipant {
  if (user === null) return null;
  return { userId: user.id, username: user.username };
}

/**
 * Build a public session snapshot from a stored record plus already-
 * resolved participants. The route layer is responsible for fetching
 * the gold/silver users (e.g. via `users.getById`) and passing them
 * in.
 */
export function buildSessionSnapshot(args: {
  record: SessionRecord;
  goldUser: UserRecord | null;
  silverUser: UserRecord | null;
}): SessionSnapshot {
  const engine = ArimaaGame.fromTranscript(args.record.transcript);
  const snapshot = engine.getSnapshot();
  const hasOpponent =
    args.record.goldUserId !== null && args.record.silverUserId !== null;
  const status = deriveSessionStatus(engine, hasOpponent);
  const { winner, reason } = unpackEngineStatus(snapshot.status);

  const sideToMove =
    status === "gold" ? "gold" : status === "silver" ? "silver" : null;

  return {
    id: args.record.id,
    status,
    sideToMove,
    transcript: args.record.transcript,
    moveLog: engine.getMoveLog().map(
      (move): SessionMoveLogEntry => ({
        moveNumber: move.moveNumber,
        side: engineSideToWire(move.side),
        notation: move.notation,
      }),
    ),
    winner,
    reason,
    participants: {
      gold: userRecordToParticipant(args.goldUser),
      silver: userRecordToParticipant(args.silverUser),
    },
    createdAt: args.record.createdAt.toISOString(),
    updatedAt: args.record.updatedAt.toISOString(),
  };
}

/**
 * Lighter "list entry" projection used by `GET /api/users/me/sessions`.
 *
 * We compute `whoseTurn` here so the games-list table can render
 * "Your turn" / "Opponent" with no follow-up logic on the client.
 */
export function buildSessionListEntry(args: {
  record: SessionRecord;
  goldUser: UserRecord | null;
  silverUser: UserRecord | null;
  viewerUserId: string;
}): SessionListEntry {
  const engine = ArimaaGame.fromTranscript(args.record.transcript);
  const engineSnap = engine.getSnapshot();
  const hasOpponent =
    args.record.goldUserId !== null && args.record.silverUserId !== null;
  const status = deriveSessionStatus(engine, hasOpponent);
  const { winner, reason } = unpackEngineStatus(engineSnap.status);
  const sideToMove =
    status === "gold" ? "gold" : status === "silver" ? "silver" : null;

  const yourSide: WireSide =
    args.record.goldUserId === args.viewerUserId ? "gold" : "silver";
  const whoseTurn =
    sideToMove === null ? null : sideToMove === yourSide ? "you" : "opponent";

  return {
    id: args.record.id,
    status,
    sideToMove,
    yourSide,
    whoseTurn,
    participants: {
      gold: userRecordToParticipant(args.goldUser),
      silver: userRecordToParticipant(args.silverUser),
    },
    winner,
    reason,
    createdAt: args.record.createdAt.toISOString(),
    updatedAt: args.record.updatedAt.toISOString(),
  };
}

/* --------------------------------------------------------------------- */
/* Move application                                                      */
/* --------------------------------------------------------------------- */

export type ApplyMoveResult =
  | { ok: true; transcript: string; engine: ArimaaGame }
  | { ok: false; reason: "wrong-turn" | "game-over" | "invalid-move" };

export function applyMoveToTranscript(
  transcript: string,
  moveNotation: string,
  expectedSide: WireSide,
): ApplyMoveResult {
  const engine = ArimaaGame.fromTranscript(transcript);
  const snapshot = engine.getSnapshot();

  if (snapshot.status.kind === "finished") {
    return { ok: false, reason: "game-over" };
  }
  if (engineSideToWire(snapshot.sideToMove) !== expectedSide) {
    return { ok: false, reason: "wrong-turn" };
  }

  const lines = transcript.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) {
    lines.pop();
  }
  const trailingLabel = lines[lines.length - 1].trim();

  if (/\s/.test(trailingLabel)) {
    return { ok: false, reason: "invalid-move" };
  }

  const moveLine = `${trailingLabel} ${moveNotation.trim()}`;
  const candidate = [...lines.slice(0, -1), moveLine].join("\n");

  try {
    const updated = ArimaaGame.fromTranscript(candidate);
    return { ok: true, transcript: updated.toTranscript(), engine: updated };
  } catch {
    return { ok: false, reason: "invalid-move" };
  }
}
