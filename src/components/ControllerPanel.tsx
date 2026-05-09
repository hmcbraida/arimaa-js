import { Check, Download, Undo2, Upload } from "lucide-react";
import { useCallback, useState } from "react";
import { type AppliedStepRecord, type ArimaaGame, Side } from "../game";
import { Button } from "./ui/Button";

/** Props for the controller panel super-component. */
interface ControllerPanelProps {
  readonly game: ArimaaGame;
  readonly onExportTranscript: () => string;
  readonly onImportTranscript: (transcript: string) => void;
  readonly onSubmitTurn: () => void;
  readonly onUndoVisibleStep: () => void;
  /** When true, the Import Game button is shown. Omit or pass false in network sessions. */
  readonly showImport?: boolean;
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
  showImport = false,
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
    <aside className="flex w-full max-w-[420px] flex-col gap-6 border-l border-tn-border pl-6">
      <header className="flex flex-col gap-4">
        <div>
          <p className="mt-1 text-sm text-tn-fg-muted">
            Current turn:{" "}
            <b>
              {sideLabel} {snapshot.moveNumber}
            </b>
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Button
            aria-label="Step backward"
            disabled={currentSteps.length === 0}
            onClick={onUndoVisibleStep}
            title="Step backward"
          >
            <Undo2 aria-hidden="true" size={18} strokeWidth={1.5} />
            <span>Step Back</span>
          </Button>
          <Button
            variant="primary"
            disabled={!game.canFinishTurn()}
            onClick={onSubmitTurn}
          >
            <Check aria-hidden="true" size={18} strokeWidth={1.5} />
            <span>Submit Turn</span>
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {showImport && (
            <Button onClick={handleOpenImportPanel}>
              <Upload aria-hidden="true" size={18} strokeWidth={1.5} />
              <span>Import Game</span>
            </Button>
          )}
          <Button
            className={showImport ? "" : "col-span-2"}
            onClick={handleOpenExportPanel}
          >
            <Download aria-hidden="true" size={18} strokeWidth={1.5} />
            <span>Export Game</span>
          </Button>
        </div>
        {(transcriptPanelMode !== null || transcriptMessage !== null) && (
          <section
            aria-label="Game transcript tools"
            className="flex flex-col gap-3 border border-tn-border p-3"
          >
            {transcriptMessage !== null && (
              <p className="text-sm text-tn-fg-muted">{transcriptMessage}</p>
            )}
            {transcriptPanelMode === "import" && (
              <>
                <label
                  className="text-sm text-tn-fg"
                  htmlFor="transcript-import"
                >
                  Transcript to import
                </label>
                <textarea
                  className="min-h-44 w-full resize-y border border-tn-border bg-tn-panel p-3 font-mono text-sm text-tn-fg focus:outline-none focus:ring-2 focus:ring-tn-blue"
                  id="transcript-import"
                  onChange={(event) => setImportDraft(event.target.value)}
                  placeholder="Paste an Arimaa setup-and-moves transcript"
                  value={importDraft}
                />
                <div className="flex gap-3">
                  <Button variant="primary" onClick={handleImport}>
                    Load Transcript
                  </Button>
                  <Button
                    onClick={() => {
                      setTranscriptPanelMode(null);
                      setTranscriptMessage(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
            {transcriptPanelMode === "export" && (
              <>
                <label
                  className="text-sm text-tn-fg"
                  htmlFor="transcript-export"
                >
                  Exported transcript
                </label>
                <textarea
                  aria-label="Exported transcript"
                  className="min-h-44 w-full resize-y border border-tn-border bg-tn-panel p-3 font-mono text-sm text-tn-fg focus:outline-none focus:ring-2 focus:ring-tn-blue"
                  id="transcript-export"
                  readOnly
                  value={exportTranscript}
                />
                <Button
                  className="self-start"
                  onClick={() => {
                    setTranscriptPanelMode(null);
                    setTranscriptMessage(null);
                  }}
                >
                  Close
                </Button>
              </>
            )}
          </section>
        )}
      </header>

      <dl className="grid grid-cols-3 gap-3 border-y border-tn-border py-4 text-sm">
        <div>
          <dt className="text-tn-fg-muted">Steps</dt>
          <dd className="mt-1 text-tn-fg">{snapshot.stepsTakenThisTurn}/4</dd>
        </div>
        <div>
          <dt className="text-tn-fg-muted">Moves</dt>
          <dd className="mt-1 text-tn-fg">{moveLog.length}</dd>
        </div>
        <div>
          <dt className="text-tn-fg-muted">Status</dt>
          <dd className="mt-1 text-tn-fg">{statusText}</dd>
        </div>
      </dl>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm uppercase text-tn-fg-muted">Current Move</h3>
        {currentSteps.length === 0 ? (
          <p className="border-t border-tn-border pt-3 text-sm text-tn-fg-muted">
            No visible steps
          </p>
        ) : (
          <StepList steps={currentSteps} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm uppercase text-tn-fg-muted">Move History</h3>
        {moveLog.length === 0 ? (
          <p className="border-t border-tn-border pt-3 text-sm text-tn-fg-muted">
            No completed moves
          </p>
        ) : (
          <div className="flex max-h-[360px] flex-col gap-4 overflow-auto pr-2">
            {moveLog.map((move) => (
              <article className="border-t border-tn-border pt-3" key={move.id}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h4 className="text-tn-fg">
                    {move.moveNumber}
                    {move.side === Side.Gold ? "g" : "s"}
                  </h4>
                  <p className="text-right font-mono text-sm text-tn-fg-muted">
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
          <span className="text-tn-fg-muted">Step {step.stepNumber}</span>
          <span className="font-mono text-tn-fg">{step.notation}</span>
        </li>
      ))}
    </ol>
  );
}
