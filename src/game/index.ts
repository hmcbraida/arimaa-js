/**
 * Public exports for the Arimaa domain package.
 *
 * Consumers should import through this module so the internal file layout can
 * evolve without changing application code.
 */

export { ArimaaGame, destinationFromDirection } from "./ArimaaGame";
export type {
  ListLegalMovesOptions,
  ListLegalStepsOptions,
} from "./ArimaaGame";
export type { AlgebraicSquare } from "./coordinates";
export {
  adjacentSquares,
  formatSquare,
  isTrapSquare,
  otherSide,
  parseSquare,
  squareEquals,
} from "./coordinates";
export {
  captureNotation,
  movementNotation,
  parseMovementNotation,
  pieceToLetter,
} from "./notation";
export {
  boardFromPlacements,
  createDefaultBoard,
  defaultPlacements,
  piece,
  type PiecePlacement,
} from "./setup";
export {
  BOARD_SIZE,
  DIRECTION_OFFSETS,
  MAX_STEPS_PER_TURN,
  PIECE_STRENGTH,
  PieceType,
  Side,
  TRAP_SQUARES,
} from "./types";
export type {
  AppliedStepRecord,
  Board,
  CaptureRecord,
  CompletedMove,
  Direction,
  FinishTurnStep,
  GameOutcomeReason,
  GameSnapshot,
  GameStatus,
  LegalMove,
  LegalStep,
  MovementStep,
  PendingAction,
  PendingPull,
  PendingPush,
  Piece,
  Square,
  SquareContents,
  StepRole,
} from "./types";
