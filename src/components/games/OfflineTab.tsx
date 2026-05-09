/**
 * Offline tab — wraps the existing single-player demo view.
 *
 * Preserves the previous `?scenario=pull` URL hook so existing
 * Playwright tests for the pull mechanic continue to work without
 * modification.
 */

import { ArimaaGame, PieceType, Side, piece } from "../../game";
import { GameView } from "../GameView";

function createInitialGame(): ArimaaGame | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);

  // The legacy hook used by the playwright suite to exercise pull
  // mechanics from a known minimal position.
  if (params.get("scenario") === "pull") {
    return ArimaaGame.fromPieces(
      [
        { square: "c2", piece: piece(Side.Gold, PieceType.Horse) },
        { square: "c1", piece: piece(Side.Silver, PieceType.Rabbit) },
        { square: "h7", piece: piece(Side.Silver, PieceType.Rabbit) },
      ],
      Side.Gold,
    );
  }
  return undefined;
}

export function OfflineTab() {
  return <GameView initialGame={createInitialGame()} />;
}
