import { type Board, BLANK } from "./board";
import type { Position, Direction } from "./position";

export class BasicStep {
  initialPos: Position;
  direction: Direction;

  constructor(initialPos: Position, direction: Direction) {
    this.initialPos = initialPos;
    this.direction = direction;
  }

  perform(board: Board) {
    const direction = this.direction;
    const initialPos = this.initialPos;

    const targetPos = initialPos.directionOf(direction);
    const currentContents = board.getSquare(initialPos);

    board.setSquare(targetPos, currentContents);
    board.setSquare(initialPos, BLANK);
  }
}

class PushPullStep {
  activePosition: Position;
  passivePosition: Position;
  direction: Direction;

  constructor(
    activePosition: Position,
    passivePosition: Position,
    direction: Direction,
  ) {
    this.activePosition = activePosition;
    this.passivePosition = passivePosition;
    this.direction = direction;
  }
}

export class PushStep extends PushPullStep {
  peform(board: Board) {
    const targetSquare = this.passivePosition.directionOf(this.direction);

    const passiveContents = board.getSquare(this.passivePosition);
    const activeContents = board.getSquare(this.activePosition);

    board.setSquare(targetSquare, passiveContents);
    board.setSquare(this.passivePosition, activeContents);
    board.setSquare(this.activePosition, BLANK);
  }
}

export class PullStep extends PushPullStep {
  perform(board: Board) {
    const targetSquare = this.activePosition.directionOf(this.direction);

    const passiveContents = board.getSquare(this.passivePosition);
    const activeContents = board.getSquare(this.activePosition);

    board.setSquare(targetSquare, activeContents);
    board.setSquare(this.activePosition, passiveContents);
    board.setSquare(this.passivePosition, BLANK);
  }
}

export type Step = BasicStep | PushStep | PullStep;
