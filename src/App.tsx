import { GameView } from "./components/GameView";
import { ArimaaGame, PieceType, Side, piece } from "./game";

function createInitialGame(): ArimaaGame | undefined {
  const params = new URLSearchParams(window.location.search);

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

/**
 * Root application component.
 *
 * Styling and UI behavior live in component modules so this file stays as a
 * simple composition boundary for Vite.
 */
export function App() {
  return <GameView initialGame={createInitialGame()} />;
}
