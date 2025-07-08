import type { Side, BoardArray } from "./board";

export interface GameState {
  board: BoardArray;
  activeSide: Side;
  stepsRemaining: number;
}
