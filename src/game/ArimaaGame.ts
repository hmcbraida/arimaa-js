import {
  type AlgebraicSquare,
  adjacentSquares,
  boardOnlyKey,
  boardPositionKey,
  cloneBoard,
  clonePendingAction,
  clonePiece,
  cloneSquare,
  formatSquare,
  getSquare,
  isBackwardRabbitStep,
  isGoalSquareForSide,
  offsetSquare,
  otherSide,
  parseSquare,
  setSquare,
  squareEquals,
  squareKey,
} from "./coordinates";
import { captureNotation, movementNotation } from "./notation";
import {
  type PiecePlacement,
  boardFromPlacements,
  createDefaultBoard,
} from "./setup";
import {
  type AppliedStepRecord,
  type Board,
  type CaptureRecord,
  type CompletedMove,
  type FinishTurnStep,
  type GameOutcomeReason,
  type GameSnapshot,
  type GameStatus,
  type LegalMove,
  type LegalStep,
  MAX_STEPS_PER_TURN,
  type MovementStep,
  PIECE_STRENGTH,
  type PendingAction,
  type Piece,
  PieceType,
  Side,
  type Square,
  type StepRole,
} from "./types";

/** Options for listing individual legal steps. */
export interface ListLegalStepsOptions {
  readonly includeFinishTurn?: boolean;
  readonly ensureCompletable?: boolean;
}

/** Options for listing legal turn completions. */
export interface ListLegalMovesOptions {
  readonly limit?: number;
}

/** Stored state used by undo and speculative search clones. */
interface StoredGameState {
  readonly board: Board;
  readonly sideToMove: Side;
  readonly moveNumber: number;
  readonly stepsTakenThisTurn: number;
  readonly turnStartBoardKey: string;
  readonly pendingAction: PendingAction | null;
  readonly positionCounts: Map<string, number>;
  readonly status: GameStatus;
  readonly history: AppliedStepRecord[];
  readonly moveLog: CompletedMove[];
  readonly currentMoveSteps: AppliedStepRecord[];
  readonly nextRecordId: number;
}

/** Internal execution flags used by search and public mutation methods. */
interface ApplyOptions {
  readonly record: boolean;
  readonly evaluateStatus?: boolean;
}

/** Hidden step singleton used whenever a turn is committed. */
const FINISH_TURN_STEP: FinishTurnStep = {
  kind: "finish-turn",
  id: "finish-turn",
  hidden: true,
  notation: "",
};

/**
 * Mutable Arimaa game engine.
 *
 * The class owns all rule state and exposes cloned snapshots to callers. React
 * components and tests should execute steps through this class rather than
 * mutating boards directly.
 */
export class ArimaaGame {
  private board: Board;
  private sideToMove: Side;
  private moveNumber: number;
  private stepsTakenThisTurn: number;
  private turnStartBoardKey: string;
  private pendingAction: PendingAction | null;
  private positionCounts: Map<string, number>;
  private status: GameStatus;
  private history: AppliedStepRecord[];
  private moveLog: CompletedMove[];
  private currentMoveSteps: AppliedStepRecord[];
  private undoStack: StoredGameState[];
  private nextRecordId: number;

  /**
   * Creates a game from a board and side to move.
   *
   * The constructor is useful for saved positions. For the demo setup or compact
   * tests, prefer `withDefaultSetup` and `fromPieces`.
   */
  public constructor(
    board: Board = createDefaultBoard(),
    sideToMove: Side = Side.Gold,
  ) {
    this.board = cloneBoard(board);
    this.sideToMove = sideToMove;
    this.moveNumber = 1;
    this.stepsTakenThisTurn = 0;
    this.turnStartBoardKey = boardOnlyKey(this.board);
    this.pendingAction = null;
    this.positionCounts = new Map([
      [boardPositionKey(this.board, this.sideToMove), 1],
    ]);
    this.status = { kind: "active" };
    this.history = [];
    this.moveLog = [];
    this.currentMoveSteps = [];
    this.undoStack = [];
    this.nextRecordId = 1;
  }

  /**
   * Creates the default playable setup used by the Vite application.
   *
   * Arimaa has free setup; this is a conventional demo position rather than a
   * mandatory rules-defined opening.
   */
  public static withDefaultSetup(): ArimaaGame {
    return new ArimaaGame(createDefaultBoard(), Side.Gold);
  }

  /**
   * Creates a game from explicit piece placements.
   *
   * Tests use this to build small positions that isolate one rule at a time.
   */
  public static fromPieces(
    placements: readonly PiecePlacement[],
    sideToMove: Side = Side.Gold,
  ): ArimaaGame {
    return new ArimaaGame(boardFromPlacements(placements), sideToMove);
  }

  /**
   * Returns a cloned public snapshot of the current game.
   *
   * The snapshot board can be safely read by UI code without risking accidental
   * mutation of the engine's live board.
   */
  public getSnapshot(): GameSnapshot {
    return {
      board: cloneBoard(this.board),
      sideToMove: this.sideToMove,
      moveNumber: this.moveNumber,
      stepsTakenThisTurn: this.stepsTakenThisTurn,
      stepsRemaining: this.stepsRemaining(),
      pendingAction: clonePendingAction(this.pendingAction),
      status: this.status,
    };
  }

  /**
   * Lists legal next steps from the current partial turn.
   *
   * By default the hidden finish-turn step is included because it is a real
   * engine step. UI components should call `listVisibleLegalSteps` instead.
   */
  public listLegalSteps(options: ListLegalStepsOptions = {}): LegalStep[] {
    const includeFinishTurn = options.includeFinishTurn ?? true;
    const ensureCompletable = options.ensureCompletable ?? true;
    const movementSteps = ensureCompletable
      ? this.generateMovementSteps().filter((step) =>
          this.stepHasLegalCompletion(step),
        )
      : this.generateMovementSteps();
    const steps: LegalStep[] = [...movementSteps];

    if (includeFinishTurn && this.canFinishTurn()) {
      steps.push(this.createFinishTurnStep());
    }

    return steps;
  }

  /**
   * Lists only user-visible movement steps.
   *
   * This method is the frontend boundary that prevents the synthetic
   * finish-turn step from leaking into board or controller UI.
   */
  public listVisibleLegalSteps(): MovementStep[] {
    return this.listLegalSteps({ includeFinishTurn: false }).filter(
      (step): step is MovementStep => step.kind === "movement",
    );
  }

  /**
   * Lists every legal way to complete the current turn.
   *
   * Returned moves use official long Arimaa notation and omit the hidden
   * finish-turn step. The optional limit is useful for exploratory UIs that only
   * need a prefix of a very large move list.
   */
  public listLegalMoves(options: ListLegalMovesOptions = {}): LegalMove[] {
    const moves: LegalMove[] = [];
    const limit = options.limit ?? Number.POSITIVE_INFINITY;

    this.collectLegalMoves(this.forkForSearch(), [], moves, limit);
    return moves;
  }

  /**
   * Executes a legal step and records it in history.
   *
   * The step must come from `listLegalSteps` or `listVisibleLegalSteps` for the
   * current state. Invalid or stale steps throw instead of silently corrupting
   * the game.
   */
  public executeStep(step: LegalStep): AppliedStepRecord {
    const legalStep = this.resolveLegalStep(step);

    // Save the exact state before mutation so undo restores turn boundaries.
    this.undoStack.push(this.captureState());

    if (legalStep.kind === "finish-turn") {
      return this.applyFinishTurnStep({ record: true, evaluateStatus: true });
    }

    return this.applyMovementStep(legalStep, { record: true });
  }

  /**
   * Finds and executes a visible movement between two squares.
   *
   * The optional role disambiguates cases where the same physical movement can
   * be either a normal step or the first step of a pull.
   */
  public executeMovement(
    from: AlgebraicSquare | Square,
    to: AlgebraicSquare | Square,
    role?: StepRole,
  ): AppliedStepRecord {
    const step = this.findLegalMovement(from, to, role);

    if (step === undefined) {
      const fromLabel = typeof from === "string" ? from : formatSquare(from);
      const toLabel = typeof to === "string" ? to : formatSquare(to);
      throw new Error(`No legal movement from ${fromLabel} to ${toLabel}`);
    }

    return this.executeStep(step);
  }

  /**
   * Executes the hidden finish-turn step.
   *
   * This is intended for engine tests, non-visual clients, and UI orchestration
   * code that auto-commits a turn after four movement steps.
   */
  public finishTurn(): AppliedStepRecord {
    return this.executeStep(this.createFinishTurnStep());
  }

  /**
   * Reports whether the current partial turn can be committed.
   *
   * A turn cannot be committed while a push or pull is unfinished, before any
   * movement step has been taken, if the board is unchanged, or if it would
   * create a third repetition.
   */
  public canFinishTurn(): boolean {
    return this.canFinishTurnInternal(false);
  }

  /**
   * Finds a legal visible movement by coordinate.
   *
   * UI code uses this to translate square clicks into the exact movement object
   * the engine expects.
   */
  public findLegalMovement(
    from: AlgebraicSquare | Square,
    to: AlgebraicSquare | Square,
    role?: StepRole,
  ): MovementStep | undefined {
    const fromSquare = typeof from === "string" ? parseSquare(from) : from;
    const toSquare = typeof to === "string" ? parseSquare(to) : to;

    return this.listVisibleLegalSteps().find(
      (step) =>
        squareEquals(step.from, fromSquare) &&
        squareEquals(step.to, toSquare) &&
        (role === undefined || step.role === role),
    );
  }

  /**
   * Returns committed moves with hidden records removed.
   *
   * The controller panel renders this structure to show a move and its component
   * movement steps.
   */
  public getMoveLog(): CompletedMove[] {
    return this.moveLog.map(cloneCompletedMove);
  }

  /**
   * Returns visible movement records for the in-progress turn.
   *
   * This gives the controller panel the same component-step view before a move
   * has been committed.
   */
  public getCurrentMoveSteps(): AppliedStepRecord[] {
    return this.currentMoveSteps.map(cloneAppliedStepRecord);
  }

  /**
   * Returns applied step history.
   *
   * Hidden finish-turn records are excluded unless explicitly requested.
   */
  public getHistory(
    options: { readonly includeHidden?: boolean } = {},
  ): AppliedStepRecord[] {
    return this.history
      .filter((record) => options.includeHidden === true || !record.hidden)
      .map(cloneAppliedStepRecord);
  }

  /**
   * Undoes the most recent raw engine step.
   *
   * This may undo a hidden finish-turn step. UI controls should normally call
   * `undoVisibleStep` so users step through visible movements only.
   */
  public undoStep(): boolean {
    const previous = this.undoStack.pop();

    if (previous === undefined) {
      return false;
    }

    this.restoreState(previous);
    return true;
  }

  /**
   * Undoes the most recent visible movement step.
   *
   * Hidden finish-turn records above that movement are undone first so the UI
   * never exposes or lands on the synthetic end-of-turn step.
   */
  public undoVisibleStep(): boolean {
    let removedHiddenStep = false;

    while (this.history.at(-1)?.hidden === true) {
      removedHiddenStep = this.undoStep() || removedHiddenStep;
    }

    const removedVisibleStep = this.undoStep();
    return removedVisibleStep || removedHiddenStep;
  }

  /**
   * Creates the internal finish-turn step value.
   *
   * A fresh object is returned to keep callers from depending on singleton
   * identity.
   */
  public createFinishTurnStep(): FinishTurnStep {
    return { ...FINISH_TURN_STEP };
  }

  /**
   * Applies a movement step without public validation.
   *
   * Search uses this after generating steps from the same state. Public
   * execution validates first and records undo state before calling this method.
   */
  private applyMovementStep(
    step: MovementStep,
    options: ApplyOptions,
  ): AppliedStepRecord {
    const piece = getSquare(this.board, step.from);

    if (!samePiece(piece, step.piece)) {
      throw new Error(
        `Expected ${step.notation} to move the piece currently on ${formatSquare(step.from)}`,
      );
    }

    // Move first; trap capture is a consequence of the new board position.
    setSquare(this.board, step.from, null);
    setSquare(this.board, step.to, clonePiece(piece));

    const captures = this.resolveTrapCaptures();
    this.pendingAction = clonePendingAction(step.pendingAction);
    this.stepsTakenThisTurn += 1;

    const notationEntries = [
      step.notation,
      ...captures.map((capture) => capture.notation),
    ];
    const record = this.createAppliedStepRecord(
      step,
      false,
      notationEntries,
      captures,
    );

    if (options.record) {
      this.history.push(record);
      this.currentMoveSteps.push(record);
    }

    return record;
  }

  /**
   * Applies the hidden finish-turn step without public validation.
   *
   * The method commits visible current-turn records into a completed move,
   * advances side and move number, records repetition state, and evaluates
   * turn-boundary wins when requested.
   */
  private applyFinishTurnStep(options: ApplyOptions): AppliedStepRecord {
    if (!this.canFinishTurn()) {
      throw new Error("The current turn cannot be finished");
    }

    const mover = this.sideToMove;
    const record = this.createAppliedStepRecord(
      this.createFinishTurnStep(),
      true,
      [],
      [],
    );

    if (options.record) {
      this.history.push(record);
      this.commitCurrentMove();
    }

    // Turn ownership changes only after the move has been committed.
    this.sideToMove = otherSide(this.sideToMove);
    if (this.sideToMove === Side.Gold) {
      this.moveNumber += 1;
    }

    this.stepsTakenThisTurn = 0;
    this.pendingAction = null;
    this.turnStartBoardKey = boardOnlyKey(this.board);

    const positionKey = boardPositionKey(this.board, this.sideToMove);
    this.positionCounts.set(
      positionKey,
      (this.positionCounts.get(positionKey) ?? 0) + 1,
    );

    if (options.evaluateStatus ?? true) {
      this.status = this.evaluateStatusAfterTurn(mover);
    }

    return record;
  }

  /**
   * Moves current visible step records into the committed move log.
   *
   * The finish-turn record is intentionally absent from the completed move so
   * notation and UI history remain user-facing.
   */
  private commitCurrentMove(): void {
    const steps = this.currentMoveSteps.map(cloneAppliedStepRecord);
    const notation = notationFromRecords(steps);
    const sideSuffix = this.sideToMove === Side.Gold ? "g" : "s";

    this.moveLog.push({
      id: `${this.moveNumber}${sideSuffix}`,
      side: this.sideToMove,
      moveNumber: this.moveNumber,
      notation,
      steps,
    });
    this.currentMoveSteps = [];
  }

  /**
   * Resolves a public step object against the current legal step list.
   *
   * This protects the mutable engine from stale objects retained by UI
   * components after an undo or rerender.
   */
  private resolveLegalStep(step: LegalStep): LegalStep {
    const legalSteps = this.listLegalSteps({ includeFinishTurn: true });
    const legalStep = legalSteps.find((candidate) => candidate.id === step.id);

    if (legalStep === undefined) {
      throw new Error(`Illegal step: ${step.id}`);
    }

    return legalStep;
  }

  /**
   * Generates primitive movement steps without completable filtering.
   *
   * This lower-level generator is used by legal move search. Public step
   * listing adds a completion check so users cannot step into a dead end.
   */
  private generateMovementSteps(): MovementStep[] {
    if (this.status.kind === "finished" || this.stepsRemaining() <= 0) {
      return [];
    }

    if (this.pendingAction !== null) {
      return this.generateForcedContinuation();
    }

    const steps: MovementStep[] = [];

    this.forEachOccupiedSquare((piece, square) => {
      if (piece.side !== this.sideToMove || this.isFrozen(square, piece)) {
        return;
      }

      // Self-movement covers ordinary steps and possible pull starts.
      this.addNormalMovementSteps(steps, piece, square);

      if (this.stepsRemaining() >= 2) {
        this.addPullStartSteps(steps, piece, square);
        this.addPushStartSteps(steps, piece, square);
      }
    });

    return steps;
  }

  /**
   * Generates the single forced continuation after a push or pull start.
   *
   * No freeze or rabbit-backward checks are applied here because the first half
   * already established a legal atomic push or pull.
   */
  private generateForcedContinuation(): MovementStep[] {
    if (this.pendingAction === null) {
      return [];
    }

    if (this.pendingAction.kind === "push") {
      const pusher = getSquare(this.board, this.pendingAction.pusherFrom);
      const destination = getSquare(this.board, this.pendingAction.pusherTo);

      if (
        !samePiece(pusher, this.pendingAction.pusher) ||
        destination !== null
      ) {
        return [];
      }

      return [
        this.createMovementStep(
          "push-complete",
          pusher,
          this.pendingAction.pusherFrom,
          this.pendingAction.pusherTo,
          null,
        ),
      ];
    }

    const pulledPiece = getSquare(this.board, this.pendingAction.pulledFrom);
    const destination = getSquare(this.board, this.pendingAction.pulledTo);

    if (
      !samePiece(pulledPiece, this.pendingAction.pulledPiece) ||
      destination !== null
    ) {
      return [];
    }

    return [
      this.createMovementStep(
        "pull-complete",
        pulledPiece,
        this.pendingAction.pulledFrom,
        this.pendingAction.pulledTo,
        null,
      ),
    ];
  }

  /**
   * Adds normal self-movement steps for an unfrozen friendly piece.
   *
   * Rabbit backward movement is rejected here because the owner is moving the
   * rabbit itself.
   */
  private addNormalMovementSteps(
    steps: MovementStep[],
    piece: Piece,
    square: Square,
  ): void {
    for (const destination of adjacentSquares(square)) {
      if (getSquare(this.board, destination) !== null) {
        continue;
      }

      if (isBackwardRabbitStep(piece, square, destination)) {
        continue;
      }

      steps.push(
        this.createMovementStep("normal", piece, square, destination, null),
      );
    }
  }

  /**
   * Adds pull-start steps for an unfrozen stronger friendly piece.
   *
   * A pull start moves the friendly piece first and records which adjacent
   * weaker enemy must be pulled into the vacated square next.
   */
  private addPullStartSteps(
    steps: MovementStep[],
    piece: Piece,
    square: Square,
  ): void {
    const weakerEnemies = adjacentSquares(square)
      .map((enemySquare) => ({
        enemySquare,
        enemy: getSquare(this.board, enemySquare),
      }))
      .filter(
        (entry): entry is { enemySquare: Square; enemy: Piece } =>
          entry.enemy !== null &&
          entry.enemy.side !== piece.side &&
          this.isStronger(piece, entry.enemy),
      );

    for (const { enemySquare, enemy } of weakerEnemies) {
      for (const destination of adjacentSquares(square)) {
        if (getSquare(this.board, destination) !== null) {
          continue;
        }

        if (isBackwardRabbitStep(piece, square, destination)) {
          continue;
        }

        const pendingAction: PendingAction = {
          kind: "pull",
          puller: clonePiece(piece),
          pullerFrom: cloneSquare(square),
          pullerTo: cloneSquare(destination),
          pulledPiece: clonePiece(enemy),
          pulledFrom: cloneSquare(enemySquare),
          pulledTo: cloneSquare(square),
        };

        steps.push(
          this.createMovementStep(
            "pull-start",
            piece,
            square,
            destination,
            pendingAction,
          ),
        );
      }
    }
  }

  /**
   * Adds push-start steps for an unfrozen stronger friendly piece.
   *
   * The first step moves the enemy piece. The pending action then forces the
   * friendly pusher into the enemy's vacated square.
   */
  private addPushStartSteps(
    steps: MovementStep[],
    piece: Piece,
    square: Square,
  ): void {
    const weakerEnemies = adjacentSquares(square)
      .map((enemySquare) => ({
        enemySquare,
        enemy: getSquare(this.board, enemySquare),
      }))
      .filter(
        (entry): entry is { enemySquare: Square; enemy: Piece } =>
          entry.enemy !== null &&
          entry.enemy.side !== piece.side &&
          this.isStronger(piece, entry.enemy),
      );

    for (const { enemySquare, enemy } of weakerEnemies) {
      for (const destination of adjacentSquares(enemySquare)) {
        if (getSquare(this.board, destination) !== null) {
          continue;
        }

        const pendingAction: PendingAction = {
          kind: "push",
          pusher: clonePiece(piece),
          pusherFrom: cloneSquare(square),
          pusherTo: cloneSquare(enemySquare),
          pushedPiece: clonePiece(enemy),
          pushedFrom: cloneSquare(enemySquare),
          pushedTo: cloneSquare(destination),
        };

        steps.push(
          this.createMovementStep(
            "push-start",
            enemy,
            enemySquare,
            destination,
            pendingAction,
          ),
        );
      }
    }
  }

  /**
   * Builds a movement step and deterministic identifier.
   *
   * The official notation can be ambiguous for pull starts, so the identifier
   * includes role and pending-action coordinates while preserving standard
   * notation separately.
   */
  private createMovementStep(
    role: StepRole,
    piece: Piece,
    from: Square,
    to: Square,
    pendingAction: PendingAction | null,
  ): MovementStep {
    const notation = movementNotation(piece, from, to);
    const pendingKey =
      pendingAction === null ? "none" : this.pendingActionKey(pendingAction);

    return {
      kind: "movement",
      id: `${role}:${notation}:${pendingKey}`,
      role,
      piece: clonePiece(piece),
      from: cloneSquare(from),
      to: cloneSquare(to),
      direction: notation.at(-1) as MovementStep["direction"],
      notation,
      pendingAction: clonePendingAction(pendingAction),
    };
  }

  /**
   * Creates a compact key for pending actions.
   *
   * This key disambiguates otherwise identical first steps that would force
   * different pushers or pulled pieces on the next step.
   */
  private pendingActionKey(action: PendingAction): string {
    if (action.kind === "push") {
      return `push:${squareKey(action.pusherFrom)}>${squareKey(action.pusherTo)}`;
    }

    return `pull:${squareKey(action.pulledFrom)}>${squareKey(action.pulledTo)}`;
  }

  /**
   * Checks whether executing a step leaves at least one legal turn completion.
   *
   * Public legal-step listing uses this to avoid exposing steps that would make
   * the player unable to finish a legal move.
   */
  private stepHasLegalCompletion(step: MovementStep): boolean {
    const game = this.forkForSearch();
    game.applyMovementStep(step, { record: false });
    return game.hasLegalCompletion(false);
  }

  /**
   * Searches for any legal way to finish the current partial turn.
   *
   * The search depth is bounded by the four-step turn limit. Repetition can be
   * ignored only when classifying whether a loss was caused specifically by the
   * third-repetition rule.
   */
  private hasLegalCompletion(ignoreRepetition: boolean): boolean {
    if (this.canFinishTurnInternal(ignoreRepetition)) {
      return true;
    }

    if (this.status.kind === "finished" || this.stepsRemaining() <= 0) {
      return false;
    }

    for (const step of this.generateMovementSteps()) {
      const game = this.forkForSearch();
      game.applyMovementStep(step, { record: false });

      if (game.hasLegalCompletion(ignoreRepetition)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Recursively collects legal turn completions.
   *
   * Search records only visible movement and trap-removal notation; the
   * finish-turn step is represented by adding a completed move to the result.
   */
  private collectLegalMoves(
    game: ArimaaGame,
    records: readonly AppliedStepRecord[],
    moves: LegalMove[],
    limit: number,
  ): void {
    if (moves.length >= limit) {
      return;
    }

    if (game.canFinishTurn()) {
      const notation = notationFromRecords(records);

      moves.push({
        side: this.sideToMove,
        moveNumber: this.moveNumber,
        notation,
        steps: records.map(cloneAppliedStepRecord),
      });
    }

    if (game.stepsRemaining() <= 0) {
      return;
    }

    for (const step of game.generateMovementSteps()) {
      if (moves.length >= limit) {
        return;
      }

      const next = game.forkForSearch();
      const record = next.applyMovementStep(step, { record: false });
      game.collectLegalMoves(next, [...records, record], moves, limit);
    }
  }

  /**
   * Determines whether a turn can end under the pass and repetition rules.
   *
   * The hidden finish-turn step is legal only after at least one movement and
   * only when no push or pull continuation is pending.
   */
  private canFinishTurnInternal(ignoreRepetition: boolean): boolean {
    if (this.status.kind === "finished") {
      return false;
    }

    if (this.pendingAction !== null || this.stepsTakenThisTurn === 0) {
      return false;
    }

    if (boardOnlyKey(this.board) === this.turnStartBoardKey) {
      return false;
    }

    if (ignoreRepetition) {
      return true;
    }

    const resultingSide = otherSide(this.sideToMove);
    const resultingPosition = boardPositionKey(this.board, resultingSide);
    return (this.positionCounts.get(resultingPosition) ?? 0) < 2;
  }

  /**
   * Evaluates turn-boundary win and loss rules.
   *
   * The order follows the official rules: mover goal, opponent goal, opponent
   * rabbit loss, mover rabbit loss, then opponent inability to move.
   */
  private evaluateStatusAfterTurn(mover: Side): GameStatus {
    const playerToMove = this.sideToMove;

    if (this.hasRabbitOnGoal(mover)) {
      return { kind: "finished", winner: mover, reason: "goal" };
    }

    if (this.hasRabbitOnGoal(playerToMove)) {
      return { kind: "finished", winner: playerToMove, reason: "goal" };
    }

    if (!this.hasRabbit(playerToMove)) {
      return { kind: "finished", winner: mover, reason: "rabbit-loss" };
    }

    if (!this.hasRabbit(mover)) {
      return { kind: "finished", winner: playerToMove, reason: "rabbit-loss" };
    }

    if (!this.hasLegalCompletion(false)) {
      const reason: GameOutcomeReason = this.hasLegalCompletion(true)
        ? "repetition"
        : "immobilized";
      return { kind: "finished", winner: mover, reason };
    }

    return { kind: "active" };
  }

  /**
   * Applies trap captures after a movement step.
   *
   * Captured pieces are removed immediately and returned in trap-square order so
   * notation is deterministic.
   */
  private resolveTrapCaptures(): CaptureRecord[] {
    const captures: CaptureRecord[] = [];

    for (const trap of [
      parseSquare("c3"),
      parseSquare("f3"),
      parseSquare("c6"),
      parseSquare("f6"),
    ]) {
      const piece = getSquare(this.board, trap);

      if (piece === null || this.hasAdjacentFriendly(trap, piece.side)) {
        continue;
      }

      const capture = {
        piece: clonePiece(piece),
        square: cloneSquare(trap),
      };
      const record = { ...capture, notation: captureNotation(capture) };

      // Remove after recording the piece so notation uses the captured type.
      setSquare(this.board, trap, null);
      captures.push(record);
    }

    return captures;
  }

  /**
   * Checks whether a piece is frozen in its current square.
   *
   * A friendly adjacent piece unfreezes it; otherwise any adjacent stronger
   * enemy freezes it.
   */
  private isFrozen(square: Square, piece: Piece): boolean {
    if (this.hasAdjacentFriendly(square, piece.side)) {
      return false;
    }

    return adjacentSquares(square).some((neighbor) => {
      const neighborPiece = getSquare(this.board, neighbor);
      return (
        neighborPiece !== null &&
        neighborPiece.side !== piece.side &&
        this.isStronger(neighborPiece, piece)
      );
    });
  }

  /**
   * Checks for adjacent friendly support.
   *
   * The same support rule is used both for freezing and for trap safety.
   */
  private hasAdjacentFriendly(square: Square, side: Side): boolean {
    return adjacentSquares(square).some((neighbor) => {
      const neighborPiece = getSquare(this.board, neighbor);
      return neighborPiece !== null && neighborPiece.side === side;
    });
  }

  /**
   * Compares piece strengths.
   *
   * Pushes, pulls, and freezing require strict strength superiority.
   */
  private isStronger(left: Piece, right: Piece): boolean {
    return PIECE_STRENGTH[left.type] > PIECE_STRENGTH[right.type];
  }

  /**
   * Checks whether a side still has at least one rabbit.
   *
   * Rabbit-loss is evaluated only after a turn is committed.
   */
  private hasRabbit(side: Side): boolean {
    let found = false;

    this.forEachOccupiedSquare((piece) => {
      if (piece.side === side && piece.type === PieceType.Rabbit) {
        found = true;
      }
    });

    return found;
  }

  /**
   * Checks whether a side has a rabbit on its goal rank.
   *
   * Goal detection is delayed until turn boundaries, matching the rules for
   * pushed or pulled rabbits that may be moved back before the turn ends.
   */
  private hasRabbitOnGoal(side: Side): boolean {
    let found = false;

    this.forEachOccupiedSquare((piece, square) => {
      if (
        piece.side === side &&
        piece.type === PieceType.Rabbit &&
        isGoalSquareForSide(square, side)
      ) {
        found = true;
      }
    });

    return found;
  }

  /**
   * Iterates every occupied square.
   *
   * The callback receives cloned coordinates because callers may store them in
   * generated steps or history records.
   */
  private forEachOccupiedSquare(
    callback: (piece: Piece, square: Square) => void,
  ): void {
    for (let rank = 0; rank < this.board.length; rank += 1) {
      for (let file = 0; file < this.board[rank].length; file += 1) {
        const piece = this.board[rank][file];

        if (piece !== null) {
          callback(piece, { file, rank });
        }
      }
    }
  }

  /**
   * Counts remaining steps in the current turn.
   *
   * Push and pull starts consult this to ensure their forced second half fits
   * inside the same turn.
   */
  private stepsRemaining(): number {
    return MAX_STEPS_PER_TURN - this.stepsTakenThisTurn;
  }

  /**
   * Creates an applied record for movement or hidden finish-turn steps.
   *
   * Record construction is centralized so history, current move steps, and
   * legal move previews share the same shape.
   */
  private createAppliedStepRecord(
    step: LegalStep,
    hidden: boolean,
    notationEntries: readonly string[],
    captures: readonly CaptureRecord[],
  ): AppliedStepRecord {
    const record: AppliedStepRecord = {
      id: `${this.moveNumber}-${this.sideToMove}-${this.nextRecordId}`,
      kind: step.kind,
      side: this.sideToMove,
      moveNumber: this.moveNumber,
      stepNumber: this.stepsTakenThisTurn + (step.kind === "movement" ? 0 : 1),
      hidden,
      notation: notationEntries.join(" "),
      notationEntries: [...notationEntries],
      movement: step.kind === "movement" ? cloneMovementStep(step) : null,
      captures: captures.map(cloneCaptureRecord),
    };

    this.nextRecordId += 1;
    return record;
  }

  /**
   * Captures the full mutable state for undo or search.
   *
   * The undo stack itself is intentionally not nested inside each snapshot.
   */
  private captureState(): StoredGameState {
    return {
      board: cloneBoard(this.board),
      sideToMove: this.sideToMove,
      moveNumber: this.moveNumber,
      stepsTakenThisTurn: this.stepsTakenThisTurn,
      turnStartBoardKey: this.turnStartBoardKey,
      pendingAction: clonePendingAction(this.pendingAction),
      positionCounts: new Map(this.positionCounts),
      status: this.status,
      history: this.history.map(cloneAppliedStepRecord),
      moveLog: this.moveLog.map(cloneCompletedMove),
      currentMoveSteps: this.currentMoveSteps.map(cloneAppliedStepRecord),
      nextRecordId: this.nextRecordId,
    };
  }

  /**
   * Restores a previously captured state.
   *
   * Undo uses this after popping the last snapshot from the undo stack.
   */
  private restoreState(state: StoredGameState): void {
    this.board = cloneBoard(state.board);
    this.sideToMove = state.sideToMove;
    this.moveNumber = state.moveNumber;
    this.stepsTakenThisTurn = state.stepsTakenThisTurn;
    this.turnStartBoardKey = state.turnStartBoardKey;
    this.pendingAction = clonePendingAction(state.pendingAction);
    this.positionCounts = new Map(state.positionCounts);
    this.status = state.status;
    this.history = state.history.map(cloneAppliedStepRecord);
    this.moveLog = state.moveLog.map(cloneCompletedMove);
    this.currentMoveSteps = state.currentMoveSteps.map(cloneAppliedStepRecord);
    this.nextRecordId = state.nextRecordId;
  }

  /**
   * Creates a clone suitable for speculative rule search.
   *
   * Search clones do not inherit undo stacks because they are never exposed to
   * users or mutated through public controls.
   */
  private forkForSearch(): ArimaaGame {
    const game = new ArimaaGame(this.board, this.sideToMove);
    game.restoreState(this.captureState());
    game.undoStack = [];
    return game;
  }
}

/**
 * Checks piece equality while allowing null board reads.
 *
 * This is stricter than side-only matching so stale steps cannot move a piece
 * that changed type during undo and replay.
 */
function samePiece(left: Piece | null, right: Piece): left is Piece {
  return left !== null && left.side === right.side && left.type === right.type;
}

/**
 * Clones a capture record.
 *
 * History records are treated as immutable values but cloned before crossing
 * public API boundaries.
 */
function cloneCaptureRecord(record: CaptureRecord): CaptureRecord {
  return {
    piece: clonePiece(record.piece),
    square: cloneSquare(record.square),
    notation: record.notation,
  };
}

/**
 * Clones a movement step including pending action state.
 *
 * The copy can be returned to UI code without exposing internal references.
 */
function cloneMovementStep(step: MovementStep): MovementStep {
  return {
    kind: "movement",
    id: step.id,
    role: step.role,
    piece: clonePiece(step.piece),
    from: cloneSquare(step.from),
    to: cloneSquare(step.to),
    direction: step.direction,
    notation: step.notation,
    pendingAction: clonePendingAction(step.pendingAction),
  };
}

/**
 * Clones an applied step record.
 *
 * Nested movement and capture values are copied so consumers cannot mutate
 * history retained by the engine.
 */
function cloneAppliedStepRecord(record: AppliedStepRecord): AppliedStepRecord {
  return {
    id: record.id,
    kind: record.kind,
    side: record.side,
    moveNumber: record.moveNumber,
    stepNumber: record.stepNumber,
    hidden: record.hidden,
    notation: record.notation,
    notationEntries: [...record.notationEntries],
    movement:
      record.movement === null ? null : cloneMovementStep(record.movement),
    captures: record.captures.map(cloneCaptureRecord),
  };
}

/**
 * Clones a completed move.
 *
 * Completed moves are user-facing and therefore never include hidden
 * finish-turn records.
 */
function cloneCompletedMove(move: CompletedMove): CompletedMove {
  return {
    id: move.id,
    side: move.side,
    moveNumber: move.moveNumber,
    notation: move.notation,
    steps: move.steps.map(cloneAppliedStepRecord),
  };
}

/**
 * Builds official long notation from applied movement records.
 *
 * Trap capture entries stay adjacent to the movement that caused them.
 */
function notationFromRecords(records: readonly AppliedStepRecord[]): string {
  return records.flatMap((record) => record.notationEntries).join(" ");
}

/**
 * Returns a destination square after applying a direction.
 *
 * This helper is kept for consumers that parse notation and need to recover the
 * destination without duplicating direction arithmetic.
 */
export function destinationFromDirection(
  from: Square,
  direction: MovementStep["direction"],
): Square {
  const destination = offsetSquare(from, direction);

  if (destination === null) {
    throw new Error(
      `Direction ${direction} from ${formatSquare(from)} leaves the board`,
    );
  }

  return destination;
}
