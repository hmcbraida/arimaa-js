import {
  type AlgebraicSquare,
  createEmptyBoard,
  parseSquare,
  setSquare,
} from "./coordinates";
import { type Board, type Piece, PieceType, Side } from "./types";

/**
 * A piece placement used when constructing a board.
 *
 * Arimaa has free setup, so callers can supply any legal arrangement they want
 * for tests, saved positions, or custom openings.
 */
export interface PiecePlacement {
  readonly square: AlgebraicSquare;
  readonly piece: Piece;
}

/**
 * Creates a piece object.
 *
 * The helper keeps setup arrays compact and easy to scan.
 */
export function piece(side: Side, type: PieceType): Piece {
  return { side, type };
}

/**
 * Default position used by the demo application.
 *
 * Arimaa does not mandate an opening setup. This arrangement keeps rabbits on
 * the home ranks and places stronger pieces in the second rank for each side so
 * the initial app state is immediately playable.
 */
export function defaultPlacements(): PiecePlacement[] {
  const goldBackRank: PieceType[] = [
    PieceType.Cat,
    PieceType.Dog,
    PieceType.Horse,
    PieceType.Camel,
    PieceType.Elephant,
    PieceType.Horse,
    PieceType.Dog,
    PieceType.Cat,
  ];
  const silverBackRank = goldBackRank;

  return [
    ...["a", "b", "c", "d", "e", "f", "g", "h"].map((file) => ({
      square: `${file}1` as AlgebraicSquare,
      piece: piece(Side.Gold, PieceType.Rabbit),
    })),
    ...goldBackRank.map((type, file) => ({
      square: `${String.fromCharCode(97 + file)}2` as AlgebraicSquare,
      piece: piece(Side.Gold, type),
    })),
    ...silverBackRank.map((type, file) => ({
      square: `${String.fromCharCode(97 + file)}7` as AlgebraicSquare,
      piece: piece(Side.Silver, type),
    })),
    ...["a", "b", "c", "d", "e", "f", "g", "h"].map((file) => ({
      square: `${file}8` as AlgebraicSquare,
      piece: piece(Side.Silver, PieceType.Rabbit),
    })),
  ];
}

/**
 * Builds a board from explicit placements.
 *
 * Later placements overwrite earlier placements on the same square, which is
 * useful in tests that deliberately construct compact positions.
 */
export function boardFromPlacements(
  placements: readonly PiecePlacement[],
): Board {
  const board = createEmptyBoard();

  for (const placement of placements) {
    // Convert public notation into the engine's zero-based coordinates.
    setSquare(board, parseSquare(placement.square), placement.piece);
  }

  return board;
}

/**
 * Builds the default application board.
 *
 * Keeping this in `src/game` lets tests and UI share the same initial position.
 */
export function createDefaultBoard(): Board {
  return boardFromPlacements(defaultPlacements());
}
