/**
 * Shared domain types for the Arimaa rules engine.
 *
 * These types deliberately live inside `src/game` so that the board model is
 * owned by the rules package rather than by the repository root or the React
 * frontend. UI code may import these shapes, but it should not add behavior to
 * them.
 */

/** The Arimaa board is always eight files by eight ranks. */
export const BOARD_SIZE = 8;

/** A turn can consume at most four visible movement steps. */
export const MAX_STEPS_PER_TURN = 4;

/**
 * Arimaa piece kinds ordered separately from their display letters.
 *
 * The enum values are stable strings so serialized snapshots remain readable
 * in tests and debugging output.
 */
export enum PieceType {
  Rabbit = "rabbit",
  Cat = "cat",
  Dog = "dog",
  Horse = "horse",
  Camel = "camel",
  Elephant = "elephant",
}

/**
 * The two Arimaa sides.
 *
 * Gold starts the game and moves north toward rank eight. Silver moves south
 * toward rank one.
 */
export enum Side {
  Gold = "gold",
  Silver = "silver",
}

/**
 * Zero-based board coordinate.
 *
 * `file` maps to `a` through `h`, while `rank` maps to ranks `1` through `8`.
 * The coordinate `{ file: 0, rank: 0 }` is therefore `a1`.
 */
export interface Square {
  readonly file: number;
  readonly rank: number;
}

/**
 * A single Arimaa piece.
 *
 * Pieces do not carry identities because legal play is defined only by piece
 * type, side, and square occupancy.
 */
export interface Piece {
  readonly type: PieceType;
  readonly side: Side;
}

/** Empty squares are represented by `null` for straightforward React checks. */
export type SquareContents = Piece | null;

/**
 * Mutable board matrix indexed by rank first and file second.
 *
 * The engine clones boards when exposing snapshots, so internal mutation stays
 * contained inside `ArimaaGame`.
 */
export type Board = SquareContents[][];

/** Orthogonal direction labels used by official long Arimaa notation. */
export type Direction = "n" | "s" | "e" | "w";

/** A direction vector in zero-based board coordinates. */
export interface DirectionOffset {
  readonly file: number;
  readonly rank: number;
}

/** Direction vectors from Gold's point of view, matching official notation. */
export const DIRECTION_OFFSETS: Record<Direction, DirectionOffset> = {
  n: { file: 0, rank: 1 },
  s: { file: 0, rank: -1 },
  e: { file: 1, rank: 0 },
  w: { file: -1, rank: 0 },
};

/**
 * Piece strengths used for freezing, pushing, and pulling.
 *
 * Larger numbers are stronger pieces.
 */
export const PIECE_STRENGTH: Record<PieceType, number> = {
  [PieceType.Rabbit]: 1,
  [PieceType.Cat]: 2,
  [PieceType.Dog]: 3,
  [PieceType.Horse]: 4,
  [PieceType.Camel]: 5,
  [PieceType.Elephant]: 6,
};

/** Trap squares in standard Arimaa notation order. */
export const TRAP_SQUARES: readonly Square[] = [
  { file: 2, rank: 2 },
  { file: 5, rank: 2 },
  { file: 2, rank: 5 },
  { file: 5, rank: 5 },
];

/**
 * The tactical role of a movement step.
 *
 * Normal movement and the two halves of push and pull sequences share the same
 * physical shape: one piece moves to one adjacent square.
 */
export type StepRole =
  | "normal"
  | "push-start"
  | "push-complete"
  | "pull-start"
  | "pull-complete";

/**
 * Captures are consequences of a movement step, not separate steps.
 *
 * They are still recorded because official long notation includes trap removal
 * entries next to the movement that caused them.
 */
export interface CaptureRecord {
  readonly piece: Piece;
  readonly square: Square;
  readonly notation: string;
}

/**
 * Pending state after the first half of a push.
 *
 * The pusher must move into the square vacated by the pushed piece on the next
 * step, even if the pushed piece was immediately captured by a trap.
 */
export interface PendingPush {
  readonly kind: "push";
  readonly pusher: Piece;
  readonly pusherFrom: Square;
  readonly pusherTo: Square;
  readonly pushedPiece: Piece;
  readonly pushedFrom: Square;
  readonly pushedTo: Square;
}

/**
 * Pending state after the first half of a pull.
 *
 * The pulled piece must move into the square vacated by the puller on the next
 * step. This remains true even if the puller is captured on the trap square it
 * stepped onto.
 */
export interface PendingPull {
  readonly kind: "pull";
  readonly puller: Piece;
  readonly pullerFrom: Square;
  readonly pullerTo: Square;
  readonly pulledPiece: Piece;
  readonly pulledFrom: Square;
  readonly pulledTo: Square;
}

/** Forced continuation state for an unfinished push or pull. */
export type PendingAction = PendingPush | PendingPull;

/**
 * A visible one-square movement that can be executed by the game engine.
 *
 * The `notation` field is the official long notation for the movement itself;
 * trap captures are added to the applied step record after execution.
 */
export interface MovementStep {
  readonly kind: "movement";
  readonly id: string;
  readonly role: StepRole;
  readonly piece: Piece;
  readonly from: Square;
  readonly to: Square;
  readonly direction: Direction;
  readonly notation: string;
  readonly pendingAction: PendingAction | null;
}

/**
 * Internal step used to commit the current turn and cede control.
 *
 * UI components intentionally receive only filtered history and legal movement
 * steps, so this hidden record cannot appear in the controller panel.
 */
export interface FinishTurnStep {
  readonly kind: "finish-turn";
  readonly id: "finish-turn";
  readonly hidden: true;
  readonly notation: "";
}

/** Any step the engine can execute. */
export type LegalStep = MovementStep | FinishTurnStep;

/**
 * A step after it has been applied to the game.
 *
 * Movement records are visible to users. Finish-turn records are hidden but
 * stay in the raw history so undo can restore exact turn boundaries.
 */
export interface AppliedStepRecord {
  readonly id: string;
  readonly kind: LegalStep["kind"];
  readonly side: Side;
  readonly moveNumber: number;
  readonly stepNumber: number;
  readonly hidden: boolean;
  readonly notation: string;
  readonly notationEntries: readonly string[];
  readonly movement: MovementStep | null;
  readonly captures: readonly CaptureRecord[];
}

/**
 * A committed Arimaa move.
 *
 * The move notation contains only visible movement and trap removal entries;
 * the hidden finish-turn step is not serialized.
 */
export interface CompletedMove {
  readonly id: string;
  readonly side: Side;
  readonly moveNumber: number;
  readonly notation: string;
  readonly steps: readonly AppliedStepRecord[];
}

/** Reasons a game can end at a turn boundary. */
export type GameOutcomeReason =
  | "goal"
  | "rabbit-loss"
  | "immobilized"
  | "repetition";

/** Current game status. */
export type GameStatus =
  | { readonly kind: "active" }
  | {
      readonly kind: "finished";
      readonly winner: Side;
      readonly reason: GameOutcomeReason;
    };

/**
 * Immutable public snapshot of the engine state.
 *
 * It intentionally excludes undo stacks and raw repetition maps because those
 * are implementation details of the state machine.
 */
export interface GameSnapshot {
  readonly board: Board;
  readonly sideToMove: Side;
  readonly moveNumber: number;
  readonly stepsTakenThisTurn: number;
  readonly stepsRemaining: number;
  readonly pendingAction: PendingAction | null;
  readonly status: GameStatus;
}

/**
 * A legal completion of the current turn.
 *
 * The `steps` are visible movement records only; ending the turn is implicit in
 * the fact that a move has been listed.
 */
export interface LegalMove {
  readonly side: Side;
  readonly moveNumber: number;
  readonly notation: string;
  readonly steps: readonly AppliedStepRecord[];
}
