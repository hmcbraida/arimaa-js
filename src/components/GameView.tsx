import { useCallback, useState } from "react";
import { ArimaaGame, type MovementStep } from "../game";
import { Board } from "./Board";
import { ControllerPanel } from "./ControllerPanel";

/** Props for the top-level game view. */
interface GameViewProps {
  readonly initialGame?: ArimaaGame;
}

/**
 * Composes the two main application surfaces around one game engine.
 *
 * The game object is intentionally stable and mutable. A small revision state
 * forces React to reread cloned snapshots after each engine mutation.
 */
export function GameView({ initialGame }: GameViewProps = {}) {
  const [game] = useState(() => initialGame ?? ArimaaGame.withDefaultSetup());
  const [, setRevision] = useState(0);

  /**
   * Executes a visible movement without committing the turn.
   *
   * The player must explicitly submit the turn, even after using all four
   * movement steps, so the controller remains the single turn-boundary control.
   */
  const handleStep = useCallback(
    (step: MovementStep) => {
      game.executeStep(step);
      setRevision((revision) => revision + 1);
    },
    [game],
  );

  /**
   * Commits the current move through the engine's hidden finish-turn step.
   *
   * The hidden record remains internal; users see only the completed move and
   * its visible component movement steps.
   */
  const handleSubmitTurn = useCallback(() => {
    if (game.canFinishTurn()) {
      game.finishTurn();
      setRevision((revision) => revision + 1);
    }
  }, [game]);

  /**
   * Undoes one visible movement through the engine's filtered undo method.
   *
   * Any hidden finish-turn step above that movement is removed internally first.
   */
  const handleUndoVisibleStep = useCallback(() => {
    if (game.undoVisibleStep()) {
      setRevision((revision) => revision + 1);
    }
  }, [game]);

  return (
    <main className="min-h-screen bg-stone-50 px-6 py-8 text-stone-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="border-b border-stone-300 pb-5">
          <h1 className="text-3xl font-semibold text-stone-950">Arimaa</h1>
        </header>
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          <Board
            game={game}
            onStep={handleStep}
            onUndoVisibleStep={handleUndoVisibleStep}
          />
          <ControllerPanel
            game={game}
            onSubmitTurn={handleSubmitTurn}
            onUndoVisibleStep={handleUndoVisibleStep}
          />
        </div>
      </div>
    </main>
  );
}
