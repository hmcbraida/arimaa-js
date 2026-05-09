/**
 * Unit tests for `shouldAdoptSnapshot` — the predicate that guards
 * WebSocket snapshot adoption in `NetworkGameView`.
 *
 * The bug being covered here: when the second player joins a waiting session
 * the server emits an `accepted` event whose snapshot has the same transcript
 * as before (no moves have been played) but a different status — the session
 * transitions from `"waiting"` to `"gold"`. If we only compared transcripts the
 * guard would return early and the "waiting for opponent" banner on the
 * creator's screen would never disappear.
 */

import { describe, expect, it } from "bun:test";
import type { SessionSnapshot } from "../../shared/schema";
import { shouldAdoptSnapshot } from "./NetworkGameView";

/** Minimal valid snapshot; individual tests override only the fields they care about. */
function makeSnapshot(overrides: Partial<SessionSnapshot>): SessionSnapshot {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    status: "gold",
    sideToMove: "gold",
    transcript: "1g\n",
    moveLog: [],
    winner: null,
    reason: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("shouldAdoptSnapshot", () => {
  it("returns false when transcript and status are both unchanged", () => {
    const current = makeSnapshot({});
    const incoming = makeSnapshot({});
    expect(shouldAdoptSnapshot(incoming, current)).toBe(false);
  });

  it("returns true when the transcript changes (opponent made a move)", () => {
    const current = makeSnapshot({ transcript: "1g\n" });
    const incoming = makeSnapshot({ transcript: "1g Ca2n\n2s\n" });
    expect(shouldAdoptSnapshot(incoming, current)).toBe(true);
  });

  /**
   * Regression test for the "waiting banner stays after opponent joins" bug.
   *
   * The `accepted` WebSocket event carries a snapshot where:
   *   - `status` changes from `"waiting"` → `"gold"` (game now active)
   *   - `transcript` is unchanged (no moves played yet)
   *
   * Before the fix, the guard compared only transcripts and returned
   * early, leaving the creator's snapshot in the `"waiting"` state and
   * keeping the join-code banner visible indefinitely.
   */
  it("returns true when status changes from waiting to active — the accepted-event bug", () => {
    const current = makeSnapshot({ status: "waiting", sideToMove: null });
    const incoming = makeSnapshot({ status: "gold", sideToMove: "gold" });
    expect(shouldAdoptSnapshot(incoming, current)).toBe(true);
  });

  it("returns true when the game completes (status → completed, transcript changes)", () => {
    const current = makeSnapshot({ status: "gold", transcript: "1g Ca2n\n2s\n" });
    const incoming = makeSnapshot({
      status: "completed",
      sideToMove: null,
      transcript: "1g Ca2n\n2s ra7s\n",
      winner: "silver",
      reason: "goal",
    });
    expect(shouldAdoptSnapshot(incoming, current)).toBe(true);
  });

  it("returns false when an identical snapshot is received a second time", () => {
    const snap = makeSnapshot({ status: "silver", transcript: "1g Ca2n\n2s\n" });
    expect(shouldAdoptSnapshot(snap, snap)).toBe(false);
  });
});
