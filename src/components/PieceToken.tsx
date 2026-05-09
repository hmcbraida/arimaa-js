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

/** Props for the board piece token. */
interface PieceTokenProps {
  readonly piece: Piece;
}

/**
 * Renders a single square-edged Arimaa piece marker.
 *
 * Gold pieces use an amber palette; Silver pieces use a stone palette.
 * The SVG icon inherits its fill colour from the token's `text-*` class via
 * `currentColor` so no per-icon tinting is needed.
 */
export function PieceToken({ piece }: PieceTokenProps) {
  const sideClass =
    piece.side === Side.Gold
      ? "border-amber-700 bg-amber-200 text-amber-900"
      : "border-stone-700 bg-stone-200 text-stone-600";

  const Icon = PIECE_ICONS[piece.type];

  return (
    <span
      aria-label={`${piece.side} ${PIECE_LABELS[piece.type]}`}
      className={`flex h-9 w-9 items-center justify-center border-2 ${sideClass}`}
      data-testid={`piece-${pieceToLetter(piece)}`}
    >
      <Icon className="h-7 w-7" />
    </span>
  );
}
