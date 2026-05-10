/**
 * Predicate that decides whether an incoming WebSocket snapshot
 * should replace the local snapshot held by `NetworkGameView`.
 *
 * Lives in its own file so a non-component export does not trip the
 * Fast-Refresh "only export components" lint rule on the React file
 * that consumes it.
 *
 * We skip adoption when BOTH the transcript and status are identical:
 *
 *   - Comparing transcripts prevents pointless engine rebuilds (and
 *     the accompanying loss of the player's in-progress move
 *     preview) when a duplicate event arrives with unchanged game
 *     state.
 *
 *   - Comparing status is necessary because the `accepted` event
 *     transitions status from `"waiting"` to a side-to-move value
 *     while the transcript is still the initial setup — no moves
 *     have been played yet. Without this second check the "waiting
 *     for opponent" banner would persist even after the opponent
 *     joins.
 */

import type { SessionSnapshot } from "../../shared/schema";

export function shouldAdoptSnapshot(
  incoming: SessionSnapshot,
  current: SessionSnapshot,
): boolean {
  return (
    incoming.transcript !== current.transcript ||
    incoming.status !== current.status
  );
}
