import {
  type AlgebraicSquare,
  directionBetween,
  formatSquare,
  parseSquare,
} from "./coordinates";
import {
  type CaptureRecord,
  type Direction,
  type Piece,
  PieceType,
  Side,
  type Square,
} from "./types";

/**
 * Official piece letters used by long Arimaa notation.
 *
 * Gold pieces are upper-case and Silver pieces are lower-case. Camel uses `M`
 * and `m` because cat already occupies `C` and `c`.
 */
const PIECE_TYPE_LETTERS: Record<PieceType, string> = {
  [PieceType.Rabbit]: "R",
  [PieceType.Cat]: "C",
  [PieceType.Dog]: "D",
  [PieceType.Horse]: "H",
  [PieceType.Camel]: "M",
  [PieceType.Elephant]: "E",
};

/**
 * Converts a piece to its official notation letter.
 *
 * The case carries side information so move strings can be read without a
 * separate board snapshot.
 */
export function pieceToLetter(piece: Piece): string {
  const letter = PIECE_TYPE_LETTERS[piece.type];
  return piece.side === Side.Gold ? letter : letter.toLowerCase();
}

/**
 * Serializes a one-square movement in official long notation.
 *
 * Example: a Gold rabbit moving from `a2` to `a3` becomes `Ra2n`.
 */
export function movementNotation(
  piece: Piece,
  from: Square,
  to: Square,
): string {
  return `${pieceToLetter(piece)}${formatSquare(from)}${directionBetween(from, to)}`;
}

/**
 * Serializes a trap removal in official long notation.
 *
 * Captures are emitted as `piece + square + x`, for example `rc3x`.
 */
export function captureNotation(
  capture: Omit<CaptureRecord, "notation">,
): string {
  return `${pieceToLetter(capture.piece)}${formatSquare(capture.square)}x`;
}

/**
 * Parses the movement portion of a long-notation step.
 *
 * This helper is intentionally narrow: capture and setup notation are separate
 * grammar forms and are not accepted here.
 */
export function parseMovementNotation(value: string): {
  readonly pieceLetter: string;
  readonly from: Square;
  readonly direction: Direction;
} {
  if (!/^[RCDHMErcdhme][a-h][1-8][nsew]$/.test(value)) {
    throw new Error(`Invalid movement notation: ${value}`);
  }

  return {
    pieceLetter: value[0],
    from: parseSquare(value.slice(1, 3) as AlgebraicSquare),
    direction: value[3] as Direction,
  };
}
