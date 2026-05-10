# UI Test Strategy

This document describes how the Arimaa frontend is tested, the purpose of each
layer, and how to run the suite.

---

## Test layers

### 1. Unit tests -- `bun test src/`

**What they cover**

The game engine, the server (HTTP + WebSocket), the in-memory network
fakes, and the auth-area React screens. Bun's built-in test runner
executes every `*.test.ts` and `*.test.tsx` file under `src/`.

| File | Focus |
|---|---|
| `src/game/ArimaaGame.test.ts` | Movement, freezing, push/pull mechanics, notation |
| `src/server/tests/server.test.ts` | HTTP and WebSocket server behaviour, auth flows, sessions, account lifecycle |
| `src/network/fake.test.ts` | Behavioural correctness of the in-memory `FakeAuthApiClient` and `FakeGameSessionApiClient` |
| `src/components/games/NetworkGameView.test.ts` | Snapshot-adoption predicate (`shouldAdoptSnapshot`) edge cases |
| `src/components/auth/AuthFlow.test.tsx` | Component-level tests: register, login, password-reset request, against the fakes |

Unit tests verify rules-engine correctness, server-side auth invariants,
and the auth-area component flows end-to-end at the React layer. They
do not touch a real browser; component tests use happy-dom (registered
via the bun preload `src/test-preload.ts` configured in `bunfig.toml`).

**Run**

```sh
bun run test
```

---

### 2. Browser smoke tests -- `tests/ui/app.spec.ts`

**What they cover**

End-to-end interaction on the offline game page. Playwright drives a real
browser against the Vite dev server to confirm that the board and controller
are wired to the same shared game instance.

| Test | Assertion |
|---|---|
| Move a piece | Step appears in the controller's "Current Move" panel |
| Step backward | Undo removes the step and returns the piece |
| Submit turn | Committing four steps advances the side indicator |
| Pull mechanic | A second click after a normal move can resolve as a pull |
| Import / export | Pasting a transcript loads the board; re-exporting round-trips it |

These tests catch regressions in the React state wiring and the game-engine
integration but do not check visual presentation.

**Run**

```sh
bun run test:ui
```

---

### 3. Responsive layout checks -- `tests/ui/responsive.spec.ts`

**Purpose**

The game board is an 8 × 8 interactive grid -- the hardest element to keep
well-proportioned across screen sizes. These tests encode three constraints
that, together, guarantee a usable layout at every configured viewport:

1. **No horizontal overflow.** The page's rendered width must not exceed the
   viewport width. Overflow is invisible until a user accidentally scrolls
   sideways and is the most common symptom of a broken mobile layout.

2. **Board within viewport bounds.** The `<section aria-label="Arimaa board">`
   must fit entirely within the viewport's horizontal extent. This catches
   cases where the board itself renders at the right size but is pushed
   off-screen by surrounding layout (padding, margins, sibling elements).

3. **Minimum 44 × 44 px touch targets.** Board squares and primary action
   buttons (Step Back, Submit Turn) must be at least 44 × 44 CSS pixels. This
   is the threshold below which tap accuracy degrades on a capacitive
   touch screen, per Apple HIG and WCAG 2.5.5.

**Viewport projects**

The same tests run on every Playwright project so a single `bun run test:ui`
call covers the full matrix:

| Project | Viewport | Representative device |
|---|---|---|
| `chromium` | 1280 × 720 | Desktop baseline |
| `pixel-7` | 412 × 915 | Common Android flagship (portrait) |
| `pixel-7-landscape` | 915 × 412 | Landscape phone -- stresses board height |
| `iphone-se` | 375 × 667 | Narrowest mainstream iOS device |
| `ipad` | 810 × 1080 | Mid-size tablet (portrait) |

**Interpreting failures**

- A failure on `chromium` only → desktop regression.
- Failures only on mobile projects → responsive layout bug at narrow widths.
- Failures on all projects → structural change broke a universal constraint.

Touch-target failures on mobile viewports are expected until the board
grid and button sizing are updated to account for narrow screens (see
[layout fix tracking](https://github.com/hmcbraida/arimaa-js/issues)).

---

## Running everything

```sh
# Unit tests
bun run test

# All Playwright tests (all viewports)
bun run test:ui

# Playwright tests for one specific viewport project
bunx playwright test --project=iphone-se

# Playwright tests filtered to one file
bunx playwright test tests/ui/responsive.spec.ts
```

---

## Adding new checks

- **New game-logic rule** → add a case to `ArimaaGame.test.ts`.
- **New API endpoint or auth-flow change** → add a case to
  `src/server/tests/server.test.ts` and (if the route is also called
  from the SPA) keep `src/network/fake.ts` in sync.
- **New auth-area screen** → render it through `renderScreen` in
  `src/components/auth/AuthFlow.test.tsx` and assert against the
  fake state.
- **New offline UI interaction** → add a test to `app.spec.ts`. Use
  `data-testid` attributes on board squares and `aria` roles on
  everything else.
- **New responsive constraint** → add a helper or test case to
  `responsive.spec.ts`. Keep assertions in the helper functions
  (`assertNoHorizontalOverflow`, `assertWithinViewportWidth`,
  `assertTouchTarget`) so the failure message names the element and
  the expectation, not just the raw numbers.
