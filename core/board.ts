import { type FixedSizeArray } from "../utils/array";

export enum PieceType {
  Rabbit,
  Cat,
  Dog,
  Horse,
  Camel,
  Elephant,
}

export enum Side {
  Gold,
  Silver,
}

export interface Piece {
  type: PieceType;
  side: Side;
}

export type BlankType = -1;
export const BLANK: BlankType = -1;

export type SquareContents = Piece | BlankType;

export type Board = FixedSizeArray<8, FixedSizeArray<8, SquareContents>>;

export interface Position {
  x: number;
  y: number;
}

type GetPieceType = SquareContents | null;

export function getPieceAt(board: Board, position: Position): GetPieceType {
  let row = board[position.x];

  if (!row) {
    return null;
  }

  let value = row[position.y];

  if (!value) {
    return null;
  }

  return value;
}

export function writePieceAt(
  board: Board,
  position: Position,
  value: SquareContents,
) {
  function inBounds(val: number): boolean {
    return val >= 0 && val < 8;
  }

  if (!inBounds(position.x) || !inBounds(position.y)) {
    return;
  }

  // @ts-ignore
  board[position.x][position.y] = value;
}

export function northOf(board: Board, position: Position): GetPieceType {
  return getPieceAt(board, {
    x: position.x + 1,
    y: position.y,
  });
}

export function southOf(board: Board, position: Position): GetPieceType {
  return getPieceAt(board, {
    x: position.x - 1,
    y: position.y,
  });
}

export function eastOf(board: Board, position: Position): GetPieceType {
  return getPieceAt(board, {
    x: position.x,
    y: position.y + 1,
  });
}

export function westOf(board: Board, position: Position): GetPieceType {
  return getPieceAt(board, {
    x: position.x,
    y: position.y - 1,
  });
}

function getNeighbours(
  board: Board,
  position: Position,
): Array<SquareContents> {
  const piecesInitial = [
    northOf(board, position),
    eastOf(board, position),
    southOf(board, position),
    westOf(board, position),
  ];
  let piecesFinal: Array<SquareContents> = [];

  for (const piece of piecesInitial) {
    if (!piece) {
      continue;
    }

    piecesFinal.push(piece);
  }

  return piecesFinal;
}

export function hasFriendlyNeighbour(
  board: Board,
  position: Position,
): boolean {
  let currentPiece = getPieceAt(board, position);

  if (currentPiece === null) {
    return false;
  }

  if (currentPiece === BLANK) {
    return false;
  }

  for (const piece of getNeighbours(board, position)) {
    if (piece === BLANK) {
      continue;
    }

    if (piece.side === currentPiece.side) {
      return true;
    }
  }

  return false;
}

const PiecePowerMap = {
  [PieceType.Rabbit]: 1,
  [PieceType.Cat]: 2,
  [PieceType.Dog]: 3,
  [PieceType.Horse]: 4,
  [PieceType.Camel]: 5,
  [PieceType.Elephant]: 6,
};

function getPiecePower(piece: PieceType): number {
  return PiecePowerMap[piece];
}

export function doesOverpower(subj: PieceType, obj: PieceType): boolean {
  return getPiecePower(subj) > getPiecePower(obj);
}

export function hasPowerfulEnemyNeighbour(board: Board, position: Position) {
  let currentPiece = getPieceAt(board, position);

  if (currentPiece === null) {
    return false;
  }

  if (currentPiece === BLANK) {
    return false;
  }

  for (const piece of getNeighbours(board, position)) {
    if (piece === BLANK) {
      continue;
    }

    if (piece.side !== currentPiece.side) {
      if (doesOverpower(piece.type, currentPiece.type)) {
        return true;
      }
    }
  }

  return false;
}

export function isFrozen(board: Board, position: Position) {
  return (
    hasPowerfulEnemyNeighbour(board, position) &&
    !hasFriendlyNeighbour(board, position)
  );
}
