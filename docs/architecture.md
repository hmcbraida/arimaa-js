# Architecture

This document describes the design of the Arimaa networked-play system: the server, the persistence layer, the event bus, the API contract, and the frontend.

## High-level overview

```
Browser
  │  HTTP + WS (port 8080 via nginx)
  ▼
nginx reverse proxy
  │  /api/* → api:3001
  │  /api/ws → api:3001 (HTTP Upgrade)
  │  /* → dist/index.html (SPA fallback)
  ▼
Fastify API server (Bun runtime)
  │  reads/writes sessions
  ├──▶ PostgreSQL  (session persistence)
  └──▶ NATS        (move/accept/complete event fan-out)
```

The browser SPA talks to the API over plain HTTP for all mutations (create session, submit move, accept invite) and subscribes to a per-session WebSocket stream for push notifications (opponent moves, game completion).

---

## Canonical state: the transcript

The server never stores a compiled board state. The only mutable column in the `sessions` table is `transcript` — the Arimaa engine's own text representation of the game from the opening position to the latest committed move.

On every operation that needs to validate or advance the game state, the server:

1. Fetches the stored transcript.
2. Calls `ArimaaGame.fromTranscript(transcript)` to reconstruct the full engine state.
3. Applies (or validates) the requested move via the engine's own rules.
4. If the move is legal, writes the new transcript back.

This means the database is the single source of truth and the engine is the validator. There is no separate cache, no in-memory game state to drift, and no possibility of a stored board snapshot diverging from the transcript.

---

## API contract

All request and response shapes are declared as [Zod](https://zod.dev/) schemas in `src/shared/schema.ts` and imported by both the Fastify server (for validation and serialisation) and the browser client (for response parsing). There is exactly one definition of the wire format.

### Endpoints

#### `POST /api/sessions?side=gold|silver`

Creates a new session. The creator picks a side. The server generates:

- A **secret token** (32 bytes of random data, hex-encoded) that authorises the creator to submit moves.
- An **accept token** (8 random decimal digits, zero-padded) that the creator shares with their opponent.

Both tokens are shown to the caller exactly once; only their SHA-256 hashes are stored.

Response: `{ sessionId, side, secretToken, acceptToken }`

#### `GET /api/sessions/:id`

Returns the public snapshot of any session. Contains the full transcript, move log, status, and winner/reason if the game is over. No authentication required — anyone can observe any game.

#### `POST /api/session-accept`

Body: `{ acceptToken }` — the 8-digit code shared by the creator.

Looks up the session by the hashed accept code. If found and the code has not been used before:

1. Generates a new secret token for the joining player.
2. Atomically writes the hashed token to the correct side column and nulls the accept token (making it single-use).

Response: `{ sessionId, side, secretToken }`

#### `POST /api/sessions/:id/moves`

Header: `Authorization: Bearer <secretToken>`

Body: `{ moveNotation }` — the full Arimaa long-notation string for one turn (e.g. `"Ee2n Ed2n"` for two steps).

The server:

1. Verifies the bearer token against the stored hash, deriving which side the caller is.
2. Checks that it is that side's turn.
3. Replays the transcript through the engine and attempts to apply `moveNotation`.
4. Rejects with 400 if the move is illegal, 409 if it is the wrong side's turn.
5. On success, writes the updated transcript, publishes a `move` event (or `completed` event if the game ended), and returns the new snapshot.

#### `WS /api/ws?sessionId=:id`

WebSocket endpoint. The server subscribes to the NATS subject `arimaa.sessions.<id>` and forwards each JSON event frame to the connected client. The client does not send any frames; this is a one-way push channel.

Event types: `accepted`, `move`, `completed` (defined in `src/shared/schema.ts`).

---

## Token security

| Token | Entropy | At-rest storage | Lifetime |
|---|---|---|---|
| Secret token | 256 bits (32 bytes random) | SHA-256 hash | Permanent (one per player per session) |
| Accept token | ~27 bits (8 decimal digits) | SHA-256 hash | Single-use (nulled on redemption) |

SHA-256 is used (not bcrypt) because both inputs have very high entropy — we are protecting against database-leak replay, not guessing attacks.

The accept code's lower entropy is acceptable because it is short-lived (consumed on first use) and the server limits the attack surface (one correct answer per session globally).

---

## Persistence layer

### Abstract interface

`src/server/persistence/store.ts` defines the `SessionStore` interface. All route code calls the interface and is completely decoupled from the database implementation.

```
SessionStore
  ├── createSession(...)           → SessionRecord
  ├── getById(id)                  → SessionRecord | null
  ├── consumeAcceptToken(...)      → SessionRecord | null  (atomic)
  ├── findSessionByTokenHash(...)  → { session, side } | null
  └── updateTranscript(...)        → SessionRecord
```

### Production: PostgreSQL via Drizzle ORM

`src/server/persistence/postgresStore.ts` implements `SessionStore` using [Drizzle ORM](https://orm.drizzle.team/) with typed queries. The table schema is declared in `src/server/persistence/schema.ts`.

The `consumeAcceptToken` method issues a single atomic `UPDATE ... WHERE accept_token_hash = $1 AND accept_token_hash IS NOT NULL` with a `CASE` expression to assign the token hash to the correct side column. This ensures two concurrent requests for the same accept code cannot both succeed — exactly one `UPDATE` will match the row; the second will see `accept_token_hash IS NULL` and find nothing.

### Tests: in-memory fake

`src/server/persistence/memoryStore.ts` implements `SessionStore` with a plain `Map`. JavaScript's single-threaded event loop provides the same atomicity guarantee for `consumeAcceptToken` without a transaction.

### Migrations

Drizzle-kit generates SQL migration files in `src/server/migrations/`. The production server entrypoint (`src/server/index.ts`) calls `runMigrations(databaseUrl)` before binding the HTTP port. The migration runner is idempotent — Drizzle records applied migrations in a `__drizzle_migrations` table and skips anything already present — so it is safe to call on every startup including hot reloads.

To generate a new migration after changing `schema.ts`:

```bash
bun run db:generate
```

---

## Event bus

### Abstract interface

`src/server/events/bus.ts` defines `EventBus`:

```typescript
interface EventBus {
  publish(sessionId: string, event: SessionEvent): Promise<void>;
  subscribe(sessionId: string, handler: (event: SessionEvent) => Promise<void>): Unsubscribe;
  close(): Promise<void>;
}
```

### Production: NATS

`src/server/events/natsBus.ts` maps each session to the NATS subject `arimaa.sessions.<id>`. Each message is JSON-encoded. The WebSocket route subscribes to the relevant subject on connection and drains/unsubscribes when the client disconnects.

NATS core (no JetStream) is used because persistence is not needed — the transcript is the durable record; the event bus is only for live push delivery. Any WebSocket client that was offline during a move will catch up by receiving the transcript from the REST API on reconnect.

### Tests: in-memory fake

`src/server/events/memoryBus.ts` holds a `Map<sessionId, Set<handler>>`. `publish` `await`s each handler. This lets server tests assert on WebSocket delivery without any NATS infrastructure.

---

## Frontend architecture

### Routing

[TanStack Router](https://tanstack.com/router) with code-based route configuration. Three routes:

| Path | Component | Description |
|---|---|---|
| `/` | `GamesTab` | Games table from localStorage, New/Join modals |
| `/offline` | `OfflineTab` | Standalone local game, no API |
| `/sessions/:id` | `NetworkGameTab` | Live networked game |

### NetworkProvider

`src/network/context.tsx` wraps the application in a React context that provides:

- `api` — an `HttpApiClient` for all REST calls
- `socket` — a `WebSocketSessionSocket` for push events

Both are singleton instances created once in `src/App.tsx`.

The context is split across three files to satisfy the `react-refresh/only-export-components` ESLint rule: `contextValue.ts` (plain TS, the `createContext` object), `context.tsx` (the `NetworkProvider` component), and `useNetwork.ts` (the `useNetwork` hook).

### Local credentials: localStorage

When a player creates or joins a game, the browser stores a `StoredGame` record in `localStorage` (via `src/network/storage.ts`). This record holds the session id, the player's side, and their secret token. It is what allows:

- The games table to show which sessions the user is a participant in.
- `NetworkGameView` to know which side the viewer is and whether to enable move input.
- Submit-turn requests to include the correct bearer token.

Spectators (anyone opening a `/sessions/:id` URL without a stored credential) see a read-only board.

### NetworkGameView: preview and rollback

`src/components/games/NetworkGameView.tsx` owns a local `ArimaaGame` engine instance seeded from the server's transcript. This instance is used directly by the existing `Board` and `ControllerPanel` components, which have no knowledge of the network layer.

The flow for submitting a turn:

1. The player makes moves locally. The engine applies them as a preview (steps appear on the board immediately).
2. On "Submit Turn", the component assembles the move notation from `game.getCurrentMoveSteps().flatMap(s => s.notationEntries).join(" ")` and POSTs to `/api/sessions/:id/moves`.
3. **If the server accepts**: `adoptSnapshot(response.snapshot)` replaces the local engine with a fresh instance built from the server's returned transcript. The engine key is bumped to discard the `Board`'s square-selection state.
4. **If the server rejects**: the component loops `game.undoVisibleStep()` until there is nothing left to undo, restoring the local engine to exactly the server's last known position.

### WebSocket synchronisation

`NetworkGameView` subscribes to `socket.subscribe(sessionId, handler)` on mount. When an event arrives:

1. The incoming transcript is compared to `snapshotRef.current.transcript`.
2. If it is unchanged (e.g. the user's own move echoed back after a successful POST), the event is ignored — this prevents the preview from being discarded needlessly.
3. If the transcript changed (opponent move, opponent joined, game ended), `adoptSnapshot` is called to bring the local engine in line with the server's reality.

---

## Testing strategy

### Server: Jest + in-memory fakes

`src/server/tests/server.test.ts` runs the Fastify server with `InMemorySessionStore` and `InMemoryEventBus`. No PostgreSQL or NATS is needed. The test suite uses `supertest` for HTTP and `ws` + `app.listen({port: 0})` for WebSocket assertions. Tests cover:

- Session creation and retrieval
- Accept-token redemption and double-spend prevention
- Legal move submission, wrong-turn rejection (409), invalid-move rejection (400)
- Missing and malformed bearer tokens (401)
- WebSocket event delivery after a move

### UI: Playwright

`tests/ui/` contains end-to-end tests against the running Vite dev server. These test the offline game board (move execution, undo, export/import) rather than the networked path, since the latter requires a live API.

Run all checks:

```bash
bun run test       # Unit tests
bun run test:ui    # Playwright
bun run build      # TypeScript + Vite (type errors surface here)
bun run lint       # ESLint + Biome
```
