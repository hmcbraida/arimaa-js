import { createInterface } from "node:readline/promises";

import {
  BLANK,
  Board,
  type Piece,
  PieceType,
  Side,
  type BlankType,
  type BoardArray,
  type SquareContents,
} from "./core/board";
import { Position } from "./core/position";
import { GameState } from "./core/state";
import type { FixedSizeArray } from "./utils/array";

function formatSquare(squareVal: SquareContents): string {
  if (squareVal === BLANK) {
    return "00";
  }

  const pieceTypeString = {
    [PieceType.Rabbit]: "R",
    [PieceType.Cat]: "C",
    [PieceType.Dog]: "D",
    [PieceType.Horse]: "H",
    [PieceType.Camel]: "M",
    [PieceType.Elephant]: "E",
  }[squareVal.type];

  const pieceSideString = {
    [Side.Gold]: "G",
    [Side.Silver]: "S",
  }[squareVal.side];

  return pieceSideString + pieceTypeString;
}

function formatBoard(board: Board): string {
  let resultString = "";

  for (let column = 7; column >= 0; column--) {
    let rowString = "";

    for (let row = 0; row < 8; row++) {
      const position = new Position(column, row);
      const squareVal = board.getSquare(position);

      // @ts-ignore
      rowString += formatSquare(squareVal);
      rowString += " ";
    }

    resultString += `${rowString}\n`;
    resultString += "                        \n";
  }

  return resultString;
}

function defaultStartBoard(): Board {
  function minorRow(side: Side): FixedSizeArray<8, SquareContents> {
    const result: Array<SquareContents> = [];

    for (let i = 0; i < 8; i++) {
      result.push({
        type: PieceType.Rabbit,
        side,
      });
    }

    // @ts-ignore
    return result;
  }

  function majorRow(side: Side): FixedSizeArray<8, SquareContents> {
    const result: FixedSizeArray<8, SquareContents> = [
      {
        type: PieceType.Dog,
        side,
      },
      {
        type: PieceType.Horse,
        side,
      },
      {
        type: PieceType.Cat,
        side,
      },
      {
        type: PieceType.Elephant,
        side,
      },
      {
        type: PieceType.Camel,
        side,
      },
      {
        type: PieceType.Cat,
        side,
      },
      {
        type: PieceType.Horse,
        side,
      },
      {
        type: PieceType.Dog,
        side,
      },
    ];

    return result;
  }

  function blankRow(): FixedSizeArray<8, SquareContents> {
    const result: Array<BlankType> = [];

    for (let i = 0; i < 8; i++) {
      result.push(BLANK);
    }

    // @ts-ignore
    return result;
  }

  const boardArray: BoardArray = [
    minorRow(Side.Gold),
    majorRow(Side.Gold),
    blankRow(),
    blankRow(),
    blankRow(),
    blankRow(),
    majorRow(Side.Silver),
    minorRow(Side.Silver),
  ];

  return new Board(boardArray);
}

const board = defaultStartBoard();

console.log(formatBoard(board));

let gameState = new GameState(board, Side.Gold);

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Toy program to make random steps.
// Does not change sides or end turn or account for holes yet.

while (true) {
  const steps = gameState.getAvailableSteps();

  const step = steps[Math.floor(Math.random() * steps.length)];
  step?.perform(board);
  console.log(formatBoard(board));

  await rl.question(">");
}
