import { Fragment, type MouseEvent, useMemo, useState } from "react";
import {
  type ArimaaGame,
  BOARD_SIZE,
  type MovementStep,
  type Square,
  formatSquare,
  isTrapSquare,
  squareEquals,
} from "../game";
import { PieceToken } from "./PieceToken";

/** Props for the interactive board super-component. */
interface BoardProps {
  readonly game: ArimaaGame;
  readonly onStep: (step: MovementStep) => void;
}

/**
 * Renders the playable Arimaa board.
 *
 * The component asks the shared engine for legal visible movement steps, then
 * translates square clicks into exact step objects for execution.
 */
export function Board({ game, onStep }: BoardProps) {
  const [selected, setSelected] = useState<Square | null>(null);
  const snapshot = game.getSnapshot();
  const legalSteps = game.listVisibleLegalSteps();
  const selectedSteps = useMemo(
    () =>
      selected === null
        ? []
        : legalSteps.filter((step) => squareEquals(step.from, selected)),
    [legalSteps, selected],
  );
  const selectedDestinations = useMemo(
    () => selectedSteps.map((step) => step.to),
    [selectedSteps],
  );
  const hasPullChoice =
    selectedSteps.some((step) => step.role === "normal") &&
    selectedSteps.some((step) => step.role === "pull-start");

  /**
   * Handles square selection and movement execution.
   *
   * A second click on a highlighted destination executes the matching movement
   * and clears selection so the next turn state is read from the engine.
   */
  function handleSquareClick(
    square: Square,
    event?: MouseEvent<HTMLButtonElement>,
  ): void {
    if (selected !== null) {
      const matchingSteps = legalSteps.filter(
        (step) =>
          squareEquals(step.from, selected) && squareEquals(step.to, square),
      );

      if (matchingSteps.length > 0) {
        // Prefer ordinary movement unless the user explicitly asks for a pull.
        const step =
          (event?.shiftKey
            ? matchingSteps.find((candidate) => candidate.role === "pull-start")
            : matchingSteps.find((candidate) => candidate.role === "normal")) ??
          matchingSteps[0];
        onStep(step);
        setSelected(null);
        return;
      }
    }

    const canStartStep = legalSteps.some((step) =>
      squareEquals(step.from, square),
    );
    setSelected(canStartStep ? square : null);
  }

  const ranks = Array.from(
    { length: BOARD_SIZE },
    (_, index) => BOARD_SIZE - index - 1,
  );
  const files = Array.from({ length: BOARD_SIZE }, (_, index) => index);

  return (
    <section aria-label="Arimaa board" className="w-full max-w-[680px]">
      <div className="grid grid-cols-[2rem_repeat(8,minmax(0,1fr))] grid-rows-[repeat(8,minmax(0,1fr))_2rem] border border-stone-950">
        {ranks.map((rank) => (
          <Fragment key={`rank-row-${rank}`}>
            <div
              className="flex items-center justify-center border-b border-stone-300 bg-stone-50 text-sm text-stone-700"
              key={`rank-${rank}`}
            >
              {rank + 1}
            </div>
            {files.map((file) => {
              const square = { file, rank };
              const squareName = formatSquare(square);
              const piece = snapshot.board[rank][file];
              const selectedSquare =
                selected !== null && squareEquals(selected, square);
              const destination = selectedDestinations.some((candidate) =>
                squareEquals(candidate, square),
              );
              const canStartStep = legalSteps.some((step) =>
                squareEquals(step.from, square),
              );
              const darkSquare = (file + rank) % 2 === 1;
              const baseColor = darkSquare ? "bg-emerald-100" : "bg-stone-100";
              const stateColor = selectedSquare
                ? "bg-amber-200"
                : destination
                  ? "bg-lime-200"
                  : baseColor;
              const cursorClass =
                canStartStep || destination
                  ? "cursor-pointer"
                  : "cursor-default";

              return (
                <button
                  aria-label={squareName}
                  className={`relative flex aspect-square min-h-12 items-center justify-center border-b border-l border-stone-300 ${stateColor} ${cursorClass} focus:outline-none focus:ring-2 focus:ring-inset focus:ring-stone-950`}
                  data-testid={`square-${squareName}`}
                  key={squareName}
                  onClick={(event) => handleSquareClick(square, event)}
                  type="button"
                >
                  {isTrapSquare(square) && (
                    <span
                      className="absolute text-lg font-bold text-rose-800/45"
                      data-testid={`trap-${squareName}`}
                    >
                      x
                    </span>
                  )}
                  {destination && piece === null && (
                    <span className="h-3 w-3 border border-lime-800 bg-lime-500" />
                  )}
                  {piece !== null && <PieceToken piece={piece} />}
                </button>
              );
            })}
          </Fragment>
        ))}
        <div className="bg-stone-50" />
        {files.map((file) => (
          <div
            className="flex items-center justify-center border-l border-stone-300 bg-stone-50 text-sm text-stone-700"
            key={`file-${file}`}
          >
            {String.fromCharCode(97 + file)}
          </div>
        ))}
      </div>
      {hasPullChoice && (
        <p className="mt-3 text-sm text-stone-600">
          Hold Shift and click the destination to choose the pull instead of the
          normal step.
        </p>
      )}
    </section>
  );
}
