import { Check, Undo2 } from "lucide-react";
import { type AppliedStepRecord, type ArimaaGame, Side } from "../game";

/** Props for the controller panel super-component. */
interface ControllerPanelProps {
  readonly game: ArimaaGame;
  readonly onSubmitTurn: () => void;
  readonly onUndoVisibleStep: () => void;
}

/**
 * Renders turn state, move history, visible-step undo, and turn submission.
 *
 * The panel reads only filtered history and committed moves from the engine, so
 * hidden finish-turn records are structurally absent from this UI.
 */
export function ControllerPanel({
  game,
  onSubmitTurn,
  onUndoVisibleStep,
}: ControllerPanelProps) {
  const snapshot = game.getSnapshot();
  const moveLog = game.getMoveLog();
  const currentSteps = game.getCurrentMoveSteps();
  const visibleHistory = game.getHistory();
  const sideLabel = snapshot.sideToMove === Side.Gold ? "Gold" : "Silver";
  const statusText =
    snapshot.status.kind === "finished"
      ? `${snapshot.status.winner === Side.Gold ? "Gold" : "Silver"} won by ${snapshot.status.reason}`
      : "Active";

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
