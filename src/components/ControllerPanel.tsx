import { Check, Download, Undo2, Upload } from "lucide-react";
import { useCallback, useState } from "react";
import { type AppliedStepRecord, type ArimaaGame, Side } from "../game";

/** Props for the controller panel super-component. */
interface ControllerPanelProps {
  readonly game: ArimaaGame;
  readonly onExportTranscript: () => string;
  readonly onImportTranscript: (transcript: string) => void;
  readonly onSubmitTurn: () => void;
  readonly onUndoVisibleStep: () => void;
}

/** Controller-local transcript panel modes. */
type TranscriptPanelMode = "export" | "import" | null;

/**
 * Renders turn state, move history, visible-step undo, and turn submission.
 *
 * The panel reads only filtered history and committed moves from the engine, so
 * hidden finish-turn records are structurally absent from this UI.
 */
export function ControllerPanel({
  game,
  onExportTranscript,
  onImportTranscript,
  onSubmitTurn,
  onUndoVisibleStep,
}: ControllerPanelProps) {
  const [transcriptPanelMode, setTranscriptPanelMode] =
    useState<TranscriptPanelMode>(null);
  const [importDraft, setImportDraft] = useState("");
  const [exportTranscript, setExportTranscript] = useState("");
  const [transcriptMessage, setTranscriptMessage] = useState<string | null>(
    null,
  );
  const snapshot = game.getSnapshot();
  const moveLog = game.getMoveLog();
  const currentSteps = game.getCurrentMoveSteps();
  const visibleHistory = game.getHistory();
  const sideLabel = snapshot.sideToMove === Side.Gold ? "Gold" : "Silver";
  const statusText =
    snapshot.status.kind === "finished"
      ? `${snapshot.status.winner === Side.Gold ? "Gold" : "Silver"} won by ${snapshot.status.reason}`
      : "Active";

  /**
   * Opens the export panel with a freshly generated transcript snapshot.
   *
   * Generating on demand avoids showing stale text after additional turns are
   * played. The callback may throw when the game has an unfinished turn, and
   * the message is surfaced directly in the transcript section.
   */
  const handleOpenExportPanel = useCallback(() => {
    try {
      setExportTranscript(onExportTranscript());
      setTranscriptPanelMode("export");
      setTranscriptMessage(null);
    } catch (error) {
      setTranscriptPanelMode(null);
      setTranscriptMessage(getErrorMessage(error));
    }
  }, [onExportTranscript]);

  /**
   * Opens the import panel and clears any prior export-specific state.
   *
   * The draft is preserved so users can correct a malformed transcript without
   * re-pasting it after an error.
   */
  const handleOpenImportPanel = useCallback(() => {
    setExportTranscript("");
    setTranscriptPanelMode("import");
    setTranscriptMessage(null);
  }, []);

  /**
   * Replays the supplied transcript into a brand-new engine instance.
   *
   * Import errors are shown inline because they are usually recoverable user
   * input mistakes rather than unexpected application faults.
   */
  const handleImport = useCallback(() => {
    try {
      onImportTranscript(importDraft);
      setImportDraft("");
      setExportTranscript("");
      setTranscriptPanelMode(null);
      setTranscriptMessage("Transcript imported.");
    } catch (error) {
      setTranscriptMessage(getErrorMessage(error));
    }
  }, [importDraft, onImportTranscript]);

  return (
    <aside className="flex w-full max-w-[420px] flex-col gap-6 border-l border-stone-300 pl-6">
      <header className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-semibold text-stone-950">Controller</h2>
          <p className="mt-1 text-sm text-stone-600">
            {sideLabel} {snapshot.moveNumber}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            aria-label="Step backward"
            className="flex items-center justify-center gap-2 border border-stone-950 px-3 py-2 text-sm font-semibold text-stone-950 disabled:cursor-not-allowed disabled:border-stone-300 disabled:text-stone-300"
            disabled={visibleHistory.length === 0}
            onClick={onUndoVisibleStep}
            title="Step backward"
            type="button"
          >
            <Undo2 aria-hidden="true" size={18} strokeWidth={2} />
            <span>Step Back</span>
          </button>
          <button
            className="flex items-center justify-center gap-2 border border-stone-950 bg-stone-950 px-3 py-2 text-sm font-semibold text-stone-50 disabled:cursor-not-allowed disabled:border-stone-300 disabled:bg-transparent disabled:text-stone-300"
            disabled={!game.canFinishTurn()}
            onClick={onSubmitTurn}
            type="button"
          >
            <Check aria-hidden="true" size={18} strokeWidth={2} />
            <span>Submit Turn</span>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            className="flex items-center justify-center gap-2 border border-stone-950 px-3 py-2 text-sm font-semibold text-stone-950"
            onClick={handleOpenImportPanel}
            type="button"
          >
            <Upload aria-hidden="true" size={18} strokeWidth={2} />
            <span>Import Game</span>
          </button>
          <button
            className="flex items-center justify-center gap-2 border border-stone-950 px-3 py-2 text-sm font-semibold text-stone-950"
            onClick={handleOpenExportPanel}
            type="button"
          >
            <Download aria-hidden="true" size={18} strokeWidth={2} />
            <span>Export Game</span>
          </button>
        </div>
        {(transcriptPanelMode !== null || transcriptMessage !== null) && (
          <section
            aria-label="Game transcript tools"
            className="flex flex-col gap-3 border border-stone-300 p-3"
          >
            {transcriptMessage !== null && (
              <p className="text-sm text-stone-700">{transcriptMessage}</p>
            )}
            {transcriptPanelMode === "import" && (
              <>
                <label
                  className="text-sm font-semibold text-stone-950"
                  htmlFor="transcript-import"
                >
                  Transcript to import
                </label>
                <textarea
                  className="min-h-44 w-full resize-y border border-stone-300 p-3 font-mono text-sm text-stone-950 focus:outline-none focus:ring-2 focus:ring-stone-950"
                  id="transcript-import"
                  onChange={(event) => setImportDraft(event.target.value)}
                  placeholder="Paste an Arimaa setup-and-moves transcript"
                  value={importDraft}
                />
                <div className="flex gap-3">
                  <button
                    className="border border-stone-950 bg-stone-950 px-3 py-2 text-sm font-semibold text-stone-50"
                    onClick={handleImport}
                    type="button"
                  >
                    Load Transcript
                  </button>
                  <button
                    className="border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700"
                    onClick={() => {
                      setTranscriptPanelMode(null);
                      setTranscriptMessage(null);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
            {transcriptPanelMode === "export" && (
              <>
                <label
                  className="text-sm font-semibold text-stone-950"
                  htmlFor="transcript-export"
                >
                  Exported transcript
                </label>
                <textarea
                  aria-label="Exported transcript"
                  className="min-h-44 w-full resize-y border border-stone-300 p-3 font-mono text-sm text-stone-950 focus:outline-none focus:ring-2 focus:ring-stone-950"
                  id="transcript-export"
                  readOnly
                  value={exportTranscript}
                />
                <button
                  className="self-start border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700"
                  onClick={() => {
                    setTranscriptPanelMode(null);
                    setTranscriptMessage(null);
                  }}
                  type="button"
                >
                  Close
                </button>
              </>
            )}
          </section>
        )}
      </header>

      <dl className="grid grid-cols-3 gap-3 border-y border-stone-300 py-4 text-sm">
        <div>
          <dt className="text-stone-500">Steps</dt>
          <dd className="mt-1 font-semibold text-stone-950">
            {snapshot.stepsTakenThisTurn}/4
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">Moves</dt>
          <dd className="mt-1 font-semibold text-stone-950">
            {moveLog.length}
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">Status</dt>
          <dd className="mt-1 font-semibold text-stone-950">{statusText}</dd>
        </div>
      </dl>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase text-stone-500">
          Current Move
        </h3>
        {currentSteps.length === 0 ? (
          <p className="border-t border-stone-200 pt-3 text-sm text-stone-500">
            No visible steps
          </p>
        ) : (
          <StepList steps={currentSteps} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase text-stone-500">
          Move History
        </h3>
        {moveLog.length === 0 ? (
          <p className="border-t border-stone-200 pt-3 text-sm text-stone-500">
            No completed moves
          </p>
        ) : (
          <div className="flex max-h-[360px] flex-col gap-4 overflow-auto pr-2">
            {moveLog.map((move) => (
              <article className="border-t border-stone-200 pt-3" key={move.id}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h4 className="font-semibold text-stone-950">
                    {move.moveNumber}
                    {move.side === Side.Gold ? "g" : "s"}
                  </h4>
                  <p className="text-right font-mono text-sm text-stone-600">
                    {move.notation}
                  </p>
                </div>
                <StepList steps={move.steps} />
              </article>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}

/**
 * Extracts a readable error message for transcript operations.
 *
 * The UI only needs the human-facing message; stack traces would add noise and
 * do not help the user fix malformed input.
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unknown error occurred";
}

/** Props for rendering visible component steps. */
interface StepListProps {
  readonly steps: readonly AppliedStepRecord[];
}

/**
 * Renders visible movement records in order.
 *
 * Records are supplied by the game engine after hidden records have already
 * been filtered out.
 */
function StepList({ steps }: StepListProps) {
  return (
    <ol className="flex flex-col gap-2">
      {steps.map((step) => (
        <li
          className="flex items-center justify-between gap-4 text-sm"
          key={step.id}
        >
          <span className="text-stone-500">Step {step.stepNumber}</span>
          <span className="font-mono text-stone-950">{step.notation}</span>
        </li>
      ))}
    </ol>
  );
}
