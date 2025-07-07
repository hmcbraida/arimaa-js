import {
  BLANK,
  getPieceAt,
  PieceType,
  Side,
  type BlankType,
  type Board,
  type SquareContents,
} from "./core/board";
import type { FixedSizeArray } from "./utils/array";

function formatSquare(squareVal: SquareContents): string {
  if (squareVal === BLANK) {
    return "00";
  }

  let pieceTypeString = {
    [PieceType.Rabbit]: "R",
    [PieceType.Cat]: "C",
    [PieceType.Dog]: "D",
    [PieceType.Horse]: "H",
    [PieceType.Camel]: "M",
    [PieceType.Elephant]: "E",
  }[squareVal.type];

  let pieceSideString = {
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
      let squareVal = getPieceAt(board, {
        x: column,
        y: row,
      });
      // @ts-ignore
      rowString += formatSquare(squareVal);
      rowString += " ";
    }

    resultString += rowString + "\n";
    resultString += "                        \n";
  }

  return resultString;
}

function defaultStartBoard(): Board {
  function minorRow(side: Side): FixedSizeArray<8, SquareContents> {
    let result: Array<SquareContents> = [];

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
    let result: FixedSizeArray<8, SquareContents> = [
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
    let result: Array<BlankType> = [];

    for (let i = 0; i < 8; i++) {
      result.push(BLANK);
    }

    // @ts-ignore
    return result;
  }

  return [
    minorRow(Side.Gold),
    majorRow(Side.Gold),
    blankRow(),
    blankRow(),
    blankRow(),
    blankRow(),
    majorRow(Side.Silver),
    minorRow(Side.Silver),
  ];
}

let board = defaultStartBoard();

console.log(formatBoard(board));
