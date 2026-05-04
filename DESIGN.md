# Arimaa JS Design

## Purpose

This repository implements the board game Arimaa as a TypeScript domain
library with a small React application for exercising the game state. The core
game engine is independent of React so it can be unit tested, reused by other
interfaces, and treated as the single authority for legal steps, legal moves,
history, and undo.

## Repository Shape

- `src/game` contains the Arimaa rules engine, board types, coordinate helpers,
  notation helpers, and default setup helpers.
- `src/components` contains every React component and all Tailwind styling used
  by the frontend.
- `src/App.tsx` mounts the composed game view without owning styling or rule
  logic.
- `src/main.tsx` is the Vite entrypoint.
- `tests/ui` contains Playwright tests for the Vite application.
- Project configuration lives at the repository root for Bun, TypeScript, Jest,
  ESLint, Biome, Tailwind, Vite, and Playwright.

## Game Model

The `ArimaaGame` class owns the mutable game state. It stores the board, side to
move, move number, steps taken in the current turn, pending push or pull
continuations, repetition counts for completed turn positions, visible move log,
and full internal step history. Public snapshots clone mutable data before
returning it so consumers cannot accidentally mutate the engine.

The engine distinguishes a move from a step:

- A step is one adjacent piece movement, or the internal synthetic step that
  finishes the current turn.
- A move is the sequence of one to four visible movement steps that is committed
  when the finish-turn step is executed.

Pushes and pulls are represented as two consecutive movement steps with a
pending continuation between them. The pending continuation records the exact
source and destination required for the second step, which prevents a partial
push or pull from being mistaken for a complete legal move.

The finish-turn step is part of the engine's state machine because Arimaa allows
unused steps to be passed, but it is flagged as hidden and omitted from all UI
history and move displays. UI components use visible-history methods instead of
the raw internal history.

## Rules Coverage

The rules engine enforces the core Arimaa movement rules:

- Gold moves first.
- Pieces move orthogonally one square per movement step.
- Rabbits cannot move backward when moving on their own.
- Frozen pieces cannot move themselves.
- Stronger friendly pieces can push or pull adjacent weaker enemy pieces.
- Push and pull starts require enough remaining steps to complete.
- Trap squares at `c3`, `f3`, `c6`, and `f6` immediately remove unsupported
  pieces.
- A turn may end after one to four movement steps, but not if the board is
  unchanged from the start of the turn.
- A completed turn that would create a third occurrence of the same board and
  side to move is illegal.
- Goal, rabbit-loss, and no-legal-move win conditions are evaluated at turn
  boundaries.

## Notation

Movement and move serialization use official long Arimaa notation. A movement
step is serialized as the piece letter, source square, and direction, such as
`Ra2n`. Trap removals caused by a movement are serialized as removal entries,
such as `rc3x`, and are included in move notation next to the movement that
caused them. The synthetic finish-turn step has no notation and is never emitted
in visible move strings.

## Frontend

The Vite React app composes two super-components around one shared
`ArimaaGame` instance:

- `Board` renders the board, trap squares, pieces, and legal destinations for
  the selected square. It executes visible movement steps through the engine.
- `ControllerPanel` renders turn state, the visible component steps of the move
  history, a backward control that undoes the last visible step while skipping
  hidden finish-turn records, and a `Submit Turn` control that commits the
  current move.

The UI never commits a turn automatically. After four movement steps the board
has no further visible movement steps, but the turn remains uncommitted until
the player submits it through the controller.

The visual design is intentionally open: square board cells, no rounded edges,
no shadows, and layout spacing carried by Tailwind utility classes in component
files.

## Verification

Jest tests cover the engine's movement, trap, push, pull, notation, legal move,
and undo behavior. Playwright tests cover the mounted Vite app, including shared
state between the board and controller and the absence of any exposed
finish-turn step.
