export enum Direction {
  North,
  East,
  South,
  West,
}

export class Position {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  north(): Position {
    return new Position(this.x + 1, this.y);
  }

  east(): Position {
    return new Position(this.x, this.y + 1);
  }

  south(): Position {
    return new Position(this.x - 1, this.y);
  }

  west(): Position {
    return new Position(this.x, this.y - 1);
  }

  directionOf(direction: Direction): Position {
    const targetFn = {
      [Direction.North]: this.north,
      [Direction.East]: this.east,
      [Direction.South]: this.south,
      [Direction.West]: this.west,
    }[direction];

    return targetFn();
  }

  getNeighbourSquares(): Array<Position> {
    const firstPass = [this.north(), this.east(), this.south(), this.west()];

    const secondPass: Array<Position> = [];

    for (const pos of firstPass) {
      if (pos.isInBounds()) {
        secondPass.push(pos);
      }
    }

    return secondPass;
  }

  positionMatches(other: Position): boolean {
    return this.x === other.x && this.y === other.y;
  }

  isInBounds() {
    function coordInBounds(val: number) {
      return val >= 0 || val < 8;
    }
    return coordInBounds(this.x) && coordInBounds(this.y);
  }
}
