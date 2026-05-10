import { Fragment, useEffect, useMemo, useState } from "react";
import {
  type ArimaaGame,
  BOARD_SIZE,
  type MovementStep,
  type PendingPull,
  type Square,
  formatSquare,
  isTrapSquare,
  squareEquals,
} from "../game";
import { PieceToken } from "./PieceToken";

/** Props for the interactive board super-component. */
interface BoardProps {
  readonly game: ArimaaGame;
  /**
   * Revision counter from the parent -- incremented after every in-place engine
   * mutation. The board uses this as the memoization key for the legal-step
   * list so that an expensive listVisibleLegalSteps() call is not triggered by
   * internal state changes (selection, drag hints) that do not affect game state.
   */
  readonly revision: number;
  readonly onStep: (step: MovementStep) => void;
  readonly onUndoVisibleStep: () => void;
  /** When true, renders the board from silver's perspective (rank 1 at top, file h on left). */
  readonly flipped?: boolean;
}

interface PossibleDrag {
  readonly stepNumber: number;
  readonly pullStart: MovementStep;
}

function getPendingPull(step: MovementStep): PendingPull {
  return step.pendingAction as PendingPull;
}

/**
 * Renders the playable Arimaa board.
 *
 * The component asks the shared engine for legal visible movement steps, then
 * translates square clicks into exact step objects for execution.
 */
export function Board({
  game,
  revision,
  onStep,
  onUndoVisibleStep,
  flipped = false,
}: BoardProps) {
  const [selected, setSelected] = useState<Square | null>(null);
  const [possibleDrags, setPossibleDrags] = useState<readonly PossibleDrag[]>(
    [],
  );
  const snapshot = game.getSnapshot();
  // Memoised on revision so that selection or drag-hint changes (which do not
  // alter game state) do not trigger the expensive legal-step computation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is an intentional trigger dependency for the mutable game object
  const legalSteps = useMemo(
    () => game.listVisibleLegalSteps(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game, revision],
  );
  const pendingPull =
    snapshot.pendingAction?.kind === "pull" ? snapshot.pendingAction : null;
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
  useEffect(() => {
    if (
      possibleDrags.length > 0 &&
      (snapshot.pendingAction !== null ||
        snapshot.stepsTakenThisTurn !== possibleDrags[0].stepNumber)
    ) {
      setPossibleDrags([]);
    }
  }, [possibleDrags, snapshot.pendingAction, snapshot.stepsTakenThisTurn]);

  function collectPossibleDrags(
    matchingSteps: readonly MovementStep[],
    chosenStep: MovementStep,
  ): readonly PossibleDrag[] {
    if (chosenStep.role !== "normal") {
      return [];
    }

    return matchingSteps
      .filter((step) => step.role === "pull-start")
      .map((step) => ({
        stepNumber: snapshot.stepsTakenThisTurn + 1,
        pullStart: step,
      }));
  }

  /**
   * Handles square selection and movement execution.
   *
   * A second click on a highlighted destination executes the matching movement
   * and clears selection so the next turn state is read from the engine.
   */
  function handleSquareClick(square: Square): void {
    if (possibleDrags.length > 0) {
      const drag = possibleDrags.find(({ pullStart }) =>
        squareEquals(square, getPendingPull(pullStart).pulledFrom),
      );

      if (drag !== undefined) {
        const pendingAction = getPendingPull(drag.pullStart);
        onUndoVisibleStep();
        onStep(drag.pullStart);
        setPossibleDrags([]);
        setSelected(pendingAction.pulledFrom);
        return;
      }

      setPossibleDrags([]);
    }

    if (selected !== null) {
      const matchingSteps = legalSteps.filter(
        (step) =>
          squareEquals(step.from, selected) && squareEquals(step.to, square),
      );

      if (matchingSteps.length > 0) {
        const step =
          matchingSteps.find((candidate) => candidate.role === "normal") ??
          matchingSteps[0];
        setPossibleDrags(collectPossibleDrags(matchingSteps, step));
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

  // When flipped (silver's perspective), rank 1 is at the top and file h is on the left.
  const ranks = Array.from({ length: BOARD_SIZE }, (_, index) =>
    flipped ? index : BOARD_SIZE - index - 1,
  );
  const files = Array.from({ length: BOARD_SIZE }, (_, index) =>
    flipped ? BOARD_SIZE - index - 1 : index,
  );

  return (
    <section
      aria-label="Arimaa board"
      className="w-full max-w-[680px] overflow-x-auto"
    >
      {/* minmax(44px,1fr) keeps each column at the 44 px touch-target minimum.
          On viewports narrower than 384 px (32 px label + 8×44 px) the grid
          exceeds the section width; overflow-x-auto on the section lets users
          scroll rather than causing the columns to collapse. */}
      <div className="grid grid-cols-[2rem_repeat(8,minmax(44px,1fr))] grid-rows-[repeat(8,minmax(0,1fr))_2rem] border border-tn-border">
        {ranks.map((rank) => (
          <Fragment key={`rank-row-${rank}`}>
            <div
              className="flex items-center justify-center border-b border-tn-border bg-tn-bg text-sm text-tn-fg-muted"
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
              const possibleDragSource = possibleDrags.some(({ pullStart }) =>
                squareEquals(square, getPendingPull(pullStart).pulledFrom),
              );
              const possibleDragDestination = possibleDrags.some(
                ({ pullStart }) =>
                  squareEquals(square, getPendingPull(pullStart).pulledTo),
              );
              const canStartStep = legalSteps.some((step) =>
                squareEquals(step.from, square),
              );
              const darkSquare = (file + rank) % 2 === 1;
              const baseColor = darkSquare ? "bg-tn-surface" : "bg-tn-panel";
              const stateColor = selectedSquare
                ? "bg-tn-yellow/30"
                : destination
                  ? "bg-tn-green/25"
                  : possibleDragSource
                    ? "bg-tn-yellow/15"
                    : possibleDragDestination
                      ? "bg-tn-green/15"
                      : baseColor;
              const cursorClass =
                canStartStep || destination || possibleDragSource
                  ? "cursor-pointer"
                  : "cursor-default";

              return (
                <button
                  aria-label={squareName}
                  className={`relative flex aspect-square items-center justify-center border-b border-l border-tn-border ${stateColor} ${cursorClass} focus:outline-none focus:ring-2 focus:ring-inset focus:ring-tn-blue`}
                  data-testid={`square-${squareName}`}
                  key={squareName}
                  onClick={() => handleSquareClick(square)}
                  type="button"
                >
                  {isTrapSquare(square) && (
                    <span
                      className="absolute text-lg text-tn-red/50"
                      data-testid={`trap-${squareName}`}
                    >
                      x
                    </span>
                  )}
                  {destination && piece === null && (
                    <span className="h-3 w-3 border border-tn-green bg-tn-green/70" />
                  )}
                  {piece !== null && <PieceToken piece={piece} />}
                </button>
              );
            })}
          </Fragment>
        ))}
        <div className="bg-tn-bg" />
        {files.map((file) => (
          <div
            className="flex items-center justify-center border-l border-tn-border bg-tn-bg text-sm text-tn-fg-muted"
            key={`file-${file}`}
          >
            {String.fromCharCode(97 + file)}
          </div>
        ))}
      </div>
      {possibleDrags.length > 0 && (
        <p className="mt-3 text-sm text-tn-fg-muted">
          Select one of the weaker adjacent enemy pieces to start a pull, or
          continue with another move.
        </p>
      )}
      {pendingPull !== null && (
        <p className="mt-3 text-sm text-tn-fg-muted">
          Complete the pull by moving the dragged piece from{" "}
          {formatSquare(pendingPull.pulledFrom)} to{" "}
          {formatSquare(pendingPull.pulledTo)}.
        </p>
      )}
      {selected !== null &&
        possibleDrags.length === 0 &&
        pendingPull === null &&
        selectedSteps.some((step) => step.role === "pull-start") && (
          <p className="mt-3 text-sm text-tn-fg-muted">
            Moving away from weaker adjacent enemy pieces can be turned into a
            pull on the next click.
          </p>
        )}
    </section>
  );
}
