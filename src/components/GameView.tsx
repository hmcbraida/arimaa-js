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
 * The engine is mutable, but import must be able to replace it wholesale.
 * React therefore tracks both the current engine instance and a lightweight
 * revision counter that forces snapshot-based children to reread state after
 * in-place mutations.
 */
export function GameView({ initialGame }: GameViewProps = {}) {
  const [game, setGame] = useState(
    () => initialGame ?? ArimaaGame.withDefaultSetup(),
  );
  const [gameInstanceKey, setGameInstanceKey] = useState(0);
  const [revision, setRevision] = useState(0);

  /** Bumps the render revision after any in-place engine mutation. */
  const refreshFromMutableGame = useCallback(() => {
    setRevision((revision) => revision + 1);
  }, []);

  /**
   * Executes a visible movement without committing the turn.
   */
  const handleStep = useCallback(
    (step: MovementStep) => {
      game.executeKnownLegalStep(step);
      refreshFromMutableGame();
    },
    [game, refreshFromMutableGame],
  );

  /**
   * Commits the current move through the engine's hidden finish-turn step.
   */
  const handleSubmitTurn = useCallback(() => {
    if (game.canFinishTurn()) {
      game.finishTurn();
      refreshFromMutableGame();
    }
  }, [game, refreshFromMutableGame]);

  /**
   * Undoes one visible movement through the engine's filtered undo method.
   *
   * Any hidden finish-turn step above that movement is removed internally first.
   */
  const handleUndoVisibleStep = useCallback(() => {
    if (game.undoVisibleStep()) {
      refreshFromMutableGame();
    }
  }, [game, refreshFromMutableGame]);

  /**
   * Serializes the current game into the engine's transcript format.
   *
   * Export is intentionally routed through this component rather than the
   * controller so the transcript boundary stays aligned with engine ownership.
   */
  const handleExportTranscript = useCallback(() => game.toTranscript(), [game]);

  /**
   * Replaces the live engine with a transcript-imported game.
   *
   * Import must swap engine identity because replay creates a new rule state,
   * undo stack, and move log. Reusing the old instance would leak state across
   * two unrelated games.
   */
  const handleImportTranscript = useCallback((transcript: string) => {
    setGame(ArimaaGame.fromTranscript(transcript));
    setGameInstanceKey((key) => key + 1);
    setRevision((revision) => revision + 1);
  }, []);

  // The page chrome (heading, padding, max-width) is provided by the
  // AppShell when this component is mounted via the offline route.
  // GameView therefore only renders the board + controller pair so it
  // composes cleanly with the shell rather than duplicating headings.
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <Board
        key={gameInstanceKey}
        game={game}
        revision={revision}
        onStep={handleStep}
        onUndoVisibleStep={handleUndoVisibleStep}
      />
      <ControllerPanel
        game={game}
        onExportTranscript={handleExportTranscript}
        onImportTranscript={handleImportTranscript}
        onSubmitTurn={handleSubmitTurn}
        onUndoVisibleStep={handleUndoVisibleStep}
        showImport
      />
    </div>
  );
}
