import { type Board, BLANK } from "./board";
import type { Position } from "./position";

export class BasicStep {
  initialPos: Position;
  targetPos: Position;

  constructor(initialPos: Position, targetPos: Position) {
    this.initialPos = initialPos;
    this.targetPos = targetPos;
  }

  perform(board: Board) {
    const currentContents = board.getSquare(this.initialPos);

    board.setSquare(this.targetPos, currentContents);
    board.setSquare(this.initialPos, BLANK);
  }
}

export class PushPullStep {
  leaderInitial: Position;
  leaderTarget: Position;
  followerInitial: Position;

  constructor(
    leaderInitial: Position,
    leaderTarget: Position,
    followerInitial: Position,
  ) {
    this.leaderInitial = leaderInitial;
    this.leaderTarget = leaderTarget;
    this.followerInitial = followerInitial;
  }

  perform(board: Board) {
    const leaderContents = board.getSquare(this.leaderInitial);
    const followerContents = board.getSquare(this.followerInitial);

    board.setSquare(this.leaderTarget, leaderContents);
    board.setSquare(this.leaderInitial, followerContents);
    board.setSquare(this.followerInitial, BLANK);
  }
}

export type Step = BasicStep | PushPullStep;
