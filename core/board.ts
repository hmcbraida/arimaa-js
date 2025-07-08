import type { FixedSizeArray } from "../utils/array";

import { Position } from "./position";

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

export function otherSide(side: Side): Side {
  if (side === Side.Gold) {
    return Side.Silver;
  } else {
    return Side.Gold;
  }
}

export interface Piece {
  type: PieceType;
  side: Side;
}

export type BlankType = -1;
export const BLANK: BlankType = -1;

export type SquareContents = Piece | BlankType;

export type BoardArray = FixedSizeArray<8, FixedSizeArray<8, SquareContents>>;

export class Board {
  boardArray: BoardArray;

  constructor(boardArray: BoardArray) {
    this.boardArray = boardArray;
  }

  getSquare(position: Position): SquareContents {
    if (!position.isInBounds()) {
      throw new Error(`Position out of bounds: ${position}`);
    }

    // @ts-ignore
    return this.boardArray[position.x][position.y];
  }

  setSquare(position: Position, value: SquareContents) {
    if (!position.isInBounds()) {
      throw new Error(`Position out of bounds: ${position}`);
    }

    // @ts-ignore
    this.boardArray[position.x][position.y] = value;
  }

  getNeighbours(position: Position): Array<Piece> {
    const neighbours: Array<Piece> = [];

    for (const otherPos of position.getNeighbourSquares()) {
      const contents = this.getSquare(otherPos);

      if (contents !== BLANK) {
        neighbours.push(contents);
      }
    }

    return neighbours;
  }

  hasPowerfulEnemyNeighbour(position: Position) {
    const currentPiece = this.getSquare(position);

    if (currentPiece === null) {
      return false;
    }

    if (currentPiece === BLANK) {
      return false;
    }

    for (const piece of this.getNeighbours(position)) {
      if (piece.side !== currentPiece.side) {
        if (doesOverpower(piece.type, currentPiece.type)) {
          return true;
        }
      }
    }

    return false;
  }

  hasFriendlyNeighbour(position: Position): boolean {
    const currentPiece = this.getSquare(position);

    if (currentPiece === null) {
      return false;
    }

    if (currentPiece === BLANK) {
      return false;
    }

    for (const piece of this.getNeighbours(position)) {
      if (piece.side === currentPiece.side) {
        return true;
      }
    }

    return false;
  }

  isFrozen(position: Position): boolean {
    return (
      this.hasPowerfulEnemyNeighbour(position) &&
      !this.hasFriendlyNeighbour(position)
    );
  }
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

export function isOverHole(position: Position): boolean {
  const holeSquares: Array<Position> = [
    new Position(2, 2),
    new Position(5, 2),
    new Position(2, 5),
    new Position(5, 5),
  ];

  for (const holeSquarePosition of holeSquares) {
    if (position.positionMatches(holeSquarePosition)) {
      return true;
    }
  }

  return false;
}
