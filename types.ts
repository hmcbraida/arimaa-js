export type FixedSizeArray<N extends number, T> = N extends 0
	? never[]
	: {
			0: T;
			length: N;
		} & ReadonlyArray<T>;

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
