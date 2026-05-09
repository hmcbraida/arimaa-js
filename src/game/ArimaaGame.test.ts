import { ArimaaGame, PieceType, Side, piece } from ".";
import { sampleGameTranscript } from "./testResources/sampleGameTranscript";

/**
 * Constructs compact test games without repeating setup boilerplate.
 *
 * Each test supplies only the pieces needed for the rule being exercised.
 */
function gameWithPieces(
  placements: Parameters<typeof ArimaaGame.fromPieces>[0],
  sideToMove: Side = Side.Gold,
): ArimaaGame {
  return ArimaaGame.fromPieces(placements, sideToMove);
}

describe("ArimaaGame", () => {
  it("serializes movement and trap captures in long notation", () => {
    const game = gameWithPieces([
      { square: "c2", piece: piece(Side.Gold, PieceType.Rabbit) },
      { square: "h7", piece: piece(Side.Silver, PieceType.Rabbit) },
    ]);

    const record = game.executeMovement("c2", "c3");

    expect(record.notationEntries).toEqual(["Rc2n", "Rc3x"]);
    expect(game.getSnapshot().board[2][2]).toBeNull();
  });

  it("prevents a frozen piece from moving itself", () => {
    const game = gameWithPieces([
      { square: "d4", piece: piece(Side.Gold, PieceType.Cat) },
      { square: "d5", piece: piece(Side.Silver, PieceType.Elephant) },
      { square: "h7", piece: piece(Side.Silver, PieceType.Rabbit) },
    ]);

    expect(game.findLegalMovement("d4", "e4")).toBeUndefined();
  });

  it("requires the forced completion after a push start", () => {
    const game = gameWithPieces([
      { square: "b2", piece: piece(Side.Gold, PieceType.Horse) },
      { square: "b3", piece: piece(Side.Silver, PieceType.Rabbit) },
      { square: "h7", piece: piece(Side.Silver, PieceType.Rabbit) },
    ]);

    const pushStart = game.executeMovement("b3", "b4", "push-start");
    const legalSteps = game.listVisibleLegalSteps();

    expect(pushStart.notation).toBe("rb3n");
    expect(legalSteps).toHaveLength(1);
    expect(legalSteps[0].role).toBe("push-complete");
    expect(legalSteps[0].notation).toBe("Hb2n");

    const pushComplete = game.executeStep(legalSteps[0]);

    expect(pushComplete.notation).toBe("Hb2n");
    expect(game.getSnapshot().pendingAction).toBeNull();
  });

  it("allows a pull to complete after the puller is trapped", () => {
    const game = gameWithPieces([
      { square: "c2", piece: piece(Side.Gold, PieceType.Horse) },
      { square: "c1", piece: piece(Side.Silver, PieceType.Rabbit) },
      { square: "h7", piece: piece(Side.Silver, PieceType.Rabbit) },
    ]);

    const pullStart = game.executeMovement("c2", "c3", "pull-start");
    const continuation = game.listVisibleLegalSteps()[0];

    expect(pullStart.notationEntries).toEqual(["Hc2n", "Hc3x"]);
    expect(continuation.role).toBe("pull-complete");
    expect(continuation.notation).toBe("rc1n");

    game.executeStep(continuation);

    const snapshot = game.getSnapshot();
    expect(snapshot.board[1][2]).toEqual(piece(Side.Silver, PieceType.Rabbit));
    expect(snapshot.board[2][2]).toBeNull();
  });

  it("lists legal move completions with official long notation", () => {
    const game = gameWithPieces([
      { square: "a2", piece: piece(Side.Gold, PieceType.Rabbit) },
      { square: "h7", piece: piece(Side.Silver, PieceType.Rabbit) },
    ]);

    const moves = game.listLegalMoves({ limit: 20 });

    expect(moves.some((move) => move.notation === "Ra2n")).toBe(true);
    expect(moves.every((move) => !move.notation.includes("finish"))).toBe(true);
  });

  it("undoes visible movement while hiding finish-turn records", () => {
    const game = gameWithPieces([
      { square: "a2", piece: piece(Side.Gold, PieceType.Rabbit) },
      { square: "h7", piece: piece(Side.Silver, PieceType.Rabbit) },
    ]);

    game.executeMovement("a2", "a3");
    game.finishTurn();

    expect(game.getHistory({ includeHidden: true })).toHaveLength(2);
    expect(game.getHistory()).toHaveLength(1);
    expect(game.undoVisibleStep()).toBe(true);

    const snapshot = game.getSnapshot();
    expect(snapshot.sideToMove).toBe(Side.Gold);
    expect(snapshot.board[1][0]).toEqual(piece(Side.Gold, PieceType.Rabbit));
    expect(game.getHistory()).toHaveLength(0);
  });

  it("imports the sample transcript into the expected terminal state", () => {
    const game = ArimaaGame.fromTranscript(sampleGameTranscript);
    const snapshot = game.getSnapshot();

    expect(snapshot.status).toEqual({
      kind: "finished",
      winner: Side.Gold,
      reason: "goal",
    });
    expect(snapshot.sideToMove).toBe(Side.Silver);
    expect(snapshot.moveNumber).toBe(33);
    expect(game.getMoveLog()).toHaveLength(65);
    expect(game.toTranscript()).toBe(sampleGameTranscript);
  });

  it("exports a replayed sample transcript without changing its format", () => {
    const original = ArimaaGame.fromTranscript(sampleGameTranscript);
    const exported = original.toTranscript();
    const replayed = ArimaaGame.fromTranscript(exported);

    expect(exported).toBe(sampleGameTranscript);
    expect(replayed.toTranscript()).toBe(sampleGameTranscript);
    expect(replayed.getSnapshot()).toEqual(original.getSnapshot());
    expect(replayed.getMoveLog()).toEqual(original.getMoveLog());
  });
});
