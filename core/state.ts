import { type Side, type Board, BLANK, doesOverpower } from "./board";
import { Position } from "./position";
import { BasicStep, PushPullStep, type Step } from "./step";

export class GameState {
  board: Board;
  activeSide: Side;
  stepsRemaining: number;

  constructor(board: Board, activeSide: Side) {
    this.board = board;
    this.activeSide = activeSide;
    this.stepsRemaining = 4;
  }

  getAvailableStepsForPos(position: Position): Array<Step> {
    let results: Array<Step> = [];

    const contents = this.board.getSquare(position);

    if (contents === BLANK) {
      return [];
    }

    if (contents.side !== this.activeSide) {
      return [];
    }

    if (this.board.isFrozen(position)) {
      return [];
    }

    results = results.concat(this.getAvailableBasicStepsForPos(position));
    results = results.concat(this.getAvailablePushStepsForPos(position));
    results = results.concat(this.getAvailablePullStepsForPos(position));

    return results;
  }

  getAvailableBasicStepsForPos(position: Position): Array<BasicStep> {
    const results: Array<BasicStep> = [];

    for (const neighbourSquare of position.getNeighbourSquares()) {
      const contents = this.board.getSquare(neighbourSquare);

      if (contents !== BLANK) {
        continue;
      }

      results.push(new BasicStep(position, neighbourSquare));
    }

    return results;
  }

  getAvailablePushStepsForPos(position: Position): Array<PushPullStep> {
    const results: Array<PushPullStep> = [];
    const myContents = this.board.getSquare(position);

    if (myContents === BLANK) {
      // needed to keep typescript happy
      throw new Error(`Cannot get pushes for empty square: ${position}`);
    }

    for (const neighbourSquare of position.getNeighbourSquares()) {
      const objectContents = this.board.getSquare(neighbourSquare);

      if (objectContents === BLANK) {
        continue; // can't push air
      }

      if (!doesOverpower(myContents.type, objectContents.type)) {
        continue; // we don't dominate this piece
      }

      if (objectContents.side === myContents.side) {
        continue; // we can't push a friend
      }

      // so this is an enemy piece which we dominate.

      for (const targetSquare of neighbourSquare.getNeighbourSquares()) {
        const targetContents = this.board.getSquare(targetSquare);

        if (targetContents !== BLANK) {
          continue; // can't push into occupied space.
        }

        // we have now constructed a valid pushing move
        results.push(
          new PushPullStep(
            neighbourSquare,
            targetSquare,
            position, // note that the pusher is the "follower"
          ),
        );
      }
    }

    return results;
  }

  getAvailablePullStepsForPos(position: Position): Array<PushPullStep> {
    const results: Array<PushPullStep> = [];
    const myContents = this.board.getSquare(position);

    if (myContents === BLANK) {
      // needed to keep typescript happy
      throw new Error(`Cannot get pushes for empty square: ${position}`);
    }

    for (const neighbourSquare of position.getNeighbourSquares()) {
      const objectContents = this.board.getSquare(neighbourSquare);

      if (objectContents === BLANK) {
        continue; // can't pull air
      }

      if (!doesOverpower(myContents.type, objectContents.type)) {
        continue; // we don't dominate this piece
      }

      if (objectContents.side === myContents.side) {
        continue; // we can't pull a friend
      }

      // so this is an enemy piece which we dominate.

      for (const targetSquare of position.getNeighbourSquares()) {
        const targetContents = this.board.getSquare(targetSquare);

        if (targetContents !== BLANK) {
          continue; // can't move into occupied space.
        }

        // we have now constructed a valid pulling move
        results.push(
          new PushPullStep(
            position,
            targetSquare,
            neighbourSquare, // note that the pulled piece is the "follower"
          ),
        );
      }
    }

    return results;
  }

  getAvailableSteps(): Array<Step> {
    let results: Array<Step> = [];

    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        results = results.concat(
          this.getAvailableStepsForPos(new Position(i, j)),
        );
      }
    }

    return results;
  }
}
