import { type Piece, PieceType, Side, pieceToLetter } from "../game";

/** Human-readable piece names used in accessible labels. */
const PIECE_LABELS: Record<PieceType, string> = {
  [PieceType.Rabbit]: "Rabbit",
  [PieceType.Cat]: "Cat",
  [PieceType.Dog]: "Dog",
  [PieceType.Horse]: "Horse",
  [PieceType.Camel]: "Camel",
  [PieceType.Elephant]: "Elephant",
};

/** Props for the board piece token. */
interface PieceTokenProps {
  readonly piece: Piece;
}

/**
 * Renders a single square-edged Arimaa piece marker.
 *
 * The token uses official notation letters so it matches move history and keeps
 * the board compact enough for repeated play.
 */
export function PieceToken({ piece }: PieceTokenProps) {
  const sideClass =
    piece.side === Side.Gold
      ? "border-amber-700 bg-amber-200 text-stone-950"
      : "border-stone-700 bg-stone-200 text-stone-950";

  return (
    <span
      aria-label={`${piece.side} ${PIECE_LABELS[piece.type]}`}
      className={`flex h-9 w-9 items-center justify-center border-2 font-serif text-xl font-bold ${sideClass}`}
      data-testid={`piece-${pieceToLetter(piece)}`}
    >
      {pieceToLetter(piece)}
    </span>
  );
}
