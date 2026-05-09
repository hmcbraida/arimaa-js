import type { SVGProps } from "react";
import {
  CamelIcon,
  CatIcon,
  DogIcon,
  ElephantIcon,
  HorseIcon,
  RabbitIcon,
} from "../assets/pieces/PieceIcons";
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

/** SVG icon component for each piece type. */
const PIECE_ICONS: Record<
  PieceType,
  (props: SVGProps<SVGSVGElement>) => JSX.Element
> = {
  [PieceType.Rabbit]: RabbitIcon,
  [PieceType.Cat]: CatIcon,
  [PieceType.Dog]: DogIcon,
  [PieceType.Horse]: HorseIcon,
  [PieceType.Camel]: CamelIcon,
  [PieceType.Elephant]: ElephantIcon,
};

// Gold (#e0af68) and silver (#cfc9c2) piece styles with explicit inline values
// so the colours are guaranteed regardless of Tailwind purge or opacity handling.
const GOLD_STYLE: React.CSSProperties = {
  borderColor: "#e0af68",
  backgroundColor: "rgba(224, 175, 104, 0.18)",
  color: "#e0af68",
};
const SILVER_STYLE: React.CSSProperties = {
  borderColor: "#cfc9c2",
  backgroundColor: "rgba(207, 201, 194, 0.14)",
  color: "#cfc9c2",
};

/** Props for the board piece token. */
interface PieceTokenProps {
  readonly piece: Piece;
}

/**
 * Renders a single square-edged Arimaa piece marker.
 *
 * Gold pieces use #e0af68; silver pieces use #cfc9c2. The SVG icon inherits
 * its fill from the token's `color` via `currentColor`.
 */
export function PieceToken({ piece }: PieceTokenProps) {
  const sideStyle = piece.side === Side.Gold ? GOLD_STYLE : SILVER_STYLE;
  const Icon = PIECE_ICONS[piece.type];

  return (
    <span
      aria-label={`${piece.side} ${PIECE_LABELS[piece.type]}`}
      className="flex aspect-square w-[75%] items-center justify-center border-2"
      style={sideStyle}
      data-testid={`piece-${pieceToLetter(piece)}`}
    >
      <Icon className="h-[80%] w-[80%]" />
    </span>
  );
}
