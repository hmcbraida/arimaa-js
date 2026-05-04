import {
  BOARD_SIZE,
  type Board,
  DIRECTION_OFFSETS,
  type Direction,
  type PendingAction,
  type Piece,
  PieceType,
  Side,
  type Square,
  type SquareContents,
  TRAP_SQUARES,
} from "./types";

/** File labels used in algebraic Arimaa coordinates. */
export const FILE_LABELS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

/** Rank labels used in algebraic Arimaa coordinates. */
export const RANK_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

/** A square string such as `a1` or `h8`. */
export type AlgebraicSquare =
  `${(typeof FILE_LABELS)[number]}${(typeof RANK_LABELS)[number]}`;

/**
 * Creates an empty mutable board matrix.
 *
 * The matrix uses rank-major indexing so `board[0][0]` corresponds to `a1`.
 */
export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from<SquareContents>({ length: BOARD_SIZE }).fill(null),
  );
}

/**
 * Clones a piece value.
 *
 * Pieces are small immutable objects, but cloning keeps board snapshots
 * independent from engine internals.
 */
export function clonePiece(piece: Piece): Piece {
  return { type: piece.type, side: piece.side };
}

/**
 * Clones a square value.
 *
 * Squares are copied frequently into history records so consumers cannot
 * mutate the coordinates retained by the engine.
 */
export function cloneSquare(square: Square): Square {
  return { file: square.file, rank: square.rank };
}

/**
 * Clones a board matrix and every occupied piece.
 *
 * This is used for snapshots, undo states, and speculative rule searches.
 */
export function cloneBoard(board: Board): Board {
  return board.map((rank) =>
    rank.map((piece) => (piece === null ? null : clonePiece(piece))),
  );
}

/**
 * Clones pending push or pull state.
 *
 * Pending state is part of the rules engine rather than UI state, but public
 * snapshots still receive an isolated copy.
 */
export function clonePendingAction(
  action: PendingAction | null,
): PendingAction | null {
  if (action === null) {
    return null;
  }

  if (action.kind === "push") {
    return {
      kind: "push",
      pusher: clonePiece(action.pusher),
      pusherFrom: cloneSquare(action.pusherFrom),
      pusherTo: cloneSquare(action.pusherTo),
      pushedPiece: clonePiece(action.pushedPiece),
      pushedFrom: cloneSquare(action.pushedFrom),
      pushedTo: cloneSquare(action.pushedTo),
    };
  }

  return {
    kind: "pull",
    puller: clonePiece(action.puller),
    pullerFrom: cloneSquare(action.pullerFrom),
    pullerTo: cloneSquare(action.pullerTo),
    pulledPiece: clonePiece(action.pulledPiece),
    pulledFrom: cloneSquare(action.pulledFrom),
    pulledTo: cloneSquare(action.pulledTo),
  };
}

/**
 * Returns the opponent of the supplied side.
 *
 * Keeping this helper in the game package avoids UI code having to know enum
 * ordering or string details.
 */
export function otherSide(side: Side): Side {
  return side === Side.Gold ? Side.Silver : Side.Gold;
}

/**
 * Checks whether a square is inside the board.
 *
 * Rule generation uses this before reading any board matrix cell.
 */
export function isInsideBoard(square: Square): boolean {
  return (
    square.file >= 0 &&
    square.file < BOARD_SIZE &&
    square.rank >= 0 &&
    square.rank < BOARD_SIZE
  );
}

/**
 * Tests coordinate equality.
 *
 * The engine creates many short-lived square objects, so equality must be based
 * on coordinates rather than object identity.
 */
export function squareEquals(left: Square, right: Square): boolean {
  return left.file === right.file && left.rank === right.rank;
}

/**
 * Formats a square using standard Arimaa coordinates.
 *
 * The square `a1` is at Gold's lower-left corner.
 */
export function formatSquare(square: Square): AlgebraicSquare {
  if (!isInsideBoard(square)) {
    throw new Error(
      `Cannot format out-of-bounds square ${square.file},${square.rank}`,
    );
  }

  return `${FILE_LABELS[square.file]}${RANK_LABELS[square.rank]}` as AlgebraicSquare;
}

/**
 * Parses a standard Arimaa coordinate into a zero-based square.
 *
 * Invalid coordinates throw so callers fail near the bad input.
 */
export function parseSquare(value: AlgebraicSquare | string): Square {
  const file = FILE_LABELS.indexOf(value[0] as (typeof FILE_LABELS)[number]);
  const rank = RANK_LABELS.indexOf(value[1] as (typeof RANK_LABELS)[number]);

  if (value.length !== 2 || file === -1 || rank === -1) {
    throw new Error(`Invalid Arimaa square: ${value}`);
  }

  return { file, rank };
}

/**
 * Creates a compact coordinate key.
 *
 * Keys are used in deterministic step identifiers and maps.
 */
export function squareKey(square: Square): string {
  return formatSquare(square);
}

/**
 * Reads a board square.
 *
 * The function validates bounds to keep rule bugs from becoming silent array
 * reads against `undefined`.
 */
export function getSquare(board: Board, square: Square): SquareContents {
  if (!isInsideBoard(square)) {
    throw new Error(
      `Cannot read out-of-bounds square ${square.file},${square.rank}`,
    );
  }

  return board[square.rank][square.file];
}

/**
 * Writes a board square.
 *
 * Mutations are intentionally centralized so movement code stays easy to audit.
 */
export function setSquare(
  board: Board,
  square: Square,
  contents: SquareContents,
): void {
  if (!isInsideBoard(square)) {
    throw new Error(
      `Cannot write out-of-bounds square ${square.file},${square.rank}`,
    );
  }

  board[square.rank][square.file] = contents;
}

/**
 * Returns a neighboring square in a direction, or `null` off-board.
 *
 * Movement generation works exclusively through this helper so edge handling is
 * consistent.
 */
export function offsetSquare(
  square: Square,
  direction: Direction,
): Square | null {
  const offset = DIRECTION_OFFSETS[direction];
  const next = {
    file: square.file + offset.file,
    rank: square.rank + offset.rank,
  };

  return isInsideBoard(next) ? next : null;
}

/**
 * Lists orthogonally adjacent board squares.
 *
 * Arimaa has no diagonal movement or support, so all local rule checks use this
 * four-square neighborhood.
 */
export function adjacentSquares(square: Square): Square[] {
  return (Object.keys(DIRECTION_OFFSETS) as Direction[])
    .map((direction) => offsetSquare(square, direction))
    .filter((candidate): candidate is Square => candidate !== null);
}

/**
 * Finds the official direction between adjacent squares.
 *
 * Non-adjacent squares are not legal movement steps and therefore throw.
 */
export function directionBetween(from: Square, to: Square): Direction {
  for (const [direction, offset] of Object.entries(DIRECTION_OFFSETS) as [
    Direction,
    (typeof DIRECTION_OFFSETS)[Direction],
  ][]) {
    if (
      from.file + offset.file === to.file &&
      from.rank + offset.rank === to.rank
    ) {
      return direction;
    }
  }

  throw new Error(
    `Squares ${formatSquare(from)} and ${formatSquare(to)} are not adjacent`,
  );
}

/**
 * Checks whether a square is one of the four Arimaa traps.
 *
 * Trap detection is separate from display so both engine and board component
 * can share the same source of truth.
 */
export function isTrapSquare(square: Square): boolean {
  return TRAP_SQUARES.some((trap) => squareEquals(trap, square));
}

/**
 * Determines whether the square is a goal rank for the supplied side.
 *
 * Gold rabbits goal on rank eight; Silver rabbits goal on rank one.
 */
export function isGoalSquareForSide(square: Square, side: Side): boolean {
  return side === Side.Gold
    ? square.rank === BOARD_SIZE - 1
    : square.rank === 0;
}

/**
 * Determines whether a rabbit movement is backward for its owner.
 *
 * This check applies only to self-movement. Pushed and pulled rabbits may move
 * backward because the opponent is moving them.
 */
export function isBackwardRabbitStep(
  piece: Piece,
  from: Square,
  to: Square,
): boolean {
  if (piece.type !== PieceType.Rabbit) {
    return false;
  }

  const rankDelta = to.rank - from.rank;
  return piece.side === Side.Gold ? rankDelta < 0 : rankDelta > 0;
}

/**
 * Creates a stable board-only key.
 *
 * This key is used to detect moves equivalent to passing, where the board at
 * the end of the turn matches the board at the start of the same turn.
 */
export function boardOnlyKey(board: Board): string {
  return board
    .map((rank) =>
      rank
        .map((piece) => {
          if (piece === null) {
            return ".";
          }

          return `${piece.side[0]}${piece.type[0]}`;
        })
        .join(""),
    )
    .join("/");
}

/**
 * Creates a stable key for repetition detection.
 *
 * Official Arimaa repetition is based on the board position and the side to
 * move after a completed turn.
 */
export function boardPositionKey(board: Board, sideToMove: Side): string {
  return `${sideToMove}:${boardOnlyKey(board)}`;
}
