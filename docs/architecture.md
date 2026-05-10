# Architecture

This document describes the design of the Arimaatic networked-play
system: the server, the persistence layer, the event bus, the API
contract, the auth flow, and the frontend.

For the auth-flow details (URLs, tokens, state machine, password
reset, etc.) see [docs/auth.md](./auth.md). This document covers the
broader architecture in which the auth flow is one piece.

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
  │  reads/writes users, sessions, refresh / verification / reset tokens
  ├──▶ PostgreSQL  (durable storage)
  ├──▶ NATS        (move/accept/complete event fan-out)
  └──▶ SMTP        (verification + password-reset emails)
                   (falls back to stdout when SMTP_HOST is unset)
```

The browser SPA talks to the API over plain HTTP for all mutations
and subscribes to a per-session WebSocket stream for push
notifications (opponent moves, game completion).

---

## Canonical state: the transcript

The server never stores a compiled board state. The only mutable
column in the `sessions` table is `transcript` -- the Arimaa engine's
own text representation of the game from the opening position to the
latest committed move.

On every operation that needs to validate or advance the game state,
the server:

1. Fetches the stored transcript.
2. Calls `ArimaaGame.fromTranscript(transcript)` to reconstruct the
   full engine state.
3. Applies (or validates) the requested move via the engine's own
   rules.
4. If the move is legal, writes the new transcript back.

This means the database is the single source of truth and the engine
is the validator. There is no separate cache, no in-memory game
state to drift, and no possibility of a stored board snapshot
diverging from the transcript.

---

## API contract

All request and response shapes are declared as
[Zod](https://zod.dev/) schemas in `src/shared/schema.ts` and
imported by both the Fastify server (for validation and serialisation)
and the browser client (for response parsing). There is exactly one
definition of the wire format.

### Endpoint summary

Auth-flow endpoints (registration, login, refresh, verify, reset,
profile, account deletion) are documented in detail in
[docs/auth.md](./auth.md). Game-session endpoints:

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/api/sessions?side=gold\|silver` | Create a new game | Access token |
| `GET` | `/api/sessions/:id` | Public snapshot | None |
| `POST` | `/api/session-accept` | Join by 8-digit code | Access token |
| `POST` | `/api/sessions/:id/moves` | Submit a move | Access token |
| `GET` | `/api/users/me/sessions?limit&cursor` | List the caller's games (cursor-paginated) | Access token |
| `WS` | `/api/ws?sessionId=:id` | Live event stream | None |

Move-submission authentication is by user id: the JWT subject is
matched against the session's `gold_user_id` / `silver_user_id` to
decide which side the caller is allowed to play. A third-party
authenticated user gets a 403; an anonymous caller gets a 401.

### Snapshot shape

Every snapshot now includes a `participants` map carrying public
identity for both sides:

```ts
participants: {
  gold:   { userId: string, username: string } | null;
  silver: { userId: string, username: string } | null;
}
```

`null` either means the side has not yet been joined (waiting state)
or that the prior owner deleted their account (which sets the FK to
null but preserves the game).

### Cursor-paginated session list

`GET /api/users/me/sessions` is the games-tab data source. The
list is keyset-paginated over `(created_at desc, id asc)`. The
cursor returned in `nextCursor` is opaque to the client; it just
hands it back on the next call to advance pagination.

---

## Authentication

Two token flavours circulate in the system:

- **Refresh tokens** -- long-lived (1 year) opaque random strings,
  stored as SHA-256 hashes in `refresh_tokens`. Revocable. Held in
  the browser's localStorage as plaintext.

- **Access tokens** -- short-lived (15 minutes) signed JWTs (HS256,
  `JWT_SECRET` env var). Not stored server-side. Held in
  in-memory React state.

Refresh tokens are not JWTs specifically so they can be revoked
individually -- for password change, password reset, and account
deletion. Access tokens are JWTs specifically so they need no DB
lookup on every request.

See [docs/auth.md](./auth.md) for the complete state machine,
including how the frontend handles "stuck on login" states for
unactivated or disabled accounts.

### Email-verification and password-reset tokens

Both are short-lived (24 h) opaque random strings, hashed at rest,
single-use. The `email_verification_tokens` and
`password_reset_tokens` tables hold them. A successful password
reset additionally revokes every refresh token belonging to the user.

---

## Persistence layer

### Abstract interfaces

`src/server/persistence/store.ts` defines five interfaces, bundled
into one `DataStore`:

```
DataStore
  ├── sessions                  SessionStore
  │     ├── createSession(...)             → SessionRecord
  │     ├── getById(id)                    → SessionRecord | null
  │     ├── consumeAcceptToken(...)        → SessionRecord | null  (atomic)
  │     ├── findUserSide(sid, uid)         → { session, side } | null
  │     ├── updateTranscript(...)          → SessionRecord
  │     └── listForUser({uid, cursor, limit}) → { sessions, nextCursor }
  ├── users                     UserStore
  │     ├── createUser(...)                → UserRecord  (throws UserUniquenessError)
  │     ├── getById / findByUsername / findByEmail
  │     ├── setActivated / setDisabled
  │     ├── touchLastLogin / updatePasswordHash
  │     └── deleteUser(id)
  ├── refreshTokens             RefreshTokenStore
  │     ├── insert / findActiveByHash
  │     └── revoke / revokeAllForUser
  ├── emailVerificationTokens   EmailVerificationTokenStore
  │     ├── insert
  │     ├── consumeByHash       (atomic delete + return)
  │     └── deleteAllForUser
  └── passwordResetTokens       PasswordResetTokenStore
        ├── insert
        ├── consumeByHash
        └── deleteAllForUser
```

All route handlers depend on these interfaces, never on a query
builder directly.

### Production: PostgreSQL via Drizzle ORM

`src/server/persistence/postgresStore.ts` provides Drizzle-backed
implementations of every interface. The table schema lives in
`schema.ts`.

Key invariants enforced at the SQL layer:

- Unique indices on `users.username` and `users.email_address`.
- `ON DELETE CASCADE` from refresh / verification / reset tokens to
  users (deleting a user drops their tokens).
- `ON DELETE SET NULL` from `sessions.gold_user_id` and
  `silver_user_id` (deleting a user preserves their game history).
- The accept-token redemption is a single `UPDATE … WHERE
  accept_token_hash = $1 AND accept_token_hash IS NOT NULL` statement
  that uses a `CASE` expression to set the right side's user id; that
  is what makes it single-use safe under concurrency.

### Tests: in-memory fakes

`src/server/persistence/memoryStore.ts` implements every interface
with plain `Map` / array structures. It also re-implements the FK
cascade behaviour (`buildInMemoryDataStore` wires
`users.deleteUser` to drop refresh / verification / reset tokens
and null out the affected sessions' user-id columns) so tests
exercise the same observable semantics as production.

### Migrations

Drizzle-kit generates SQL migration files in `src/server/migrations/`.
The production server entrypoint (`src/server/index.ts`) calls
`runMigrations(databaseUrl)` before binding the HTTP port. The
migration runner is idempotent -- Drizzle records applied migrations
in a `__drizzle_migrations` table and skips anything already present —
so it is safe to call on every startup including hot reloads.

To generate a new migration after changing `schema.ts`:

```bash
bun run db:generate
```

---

## Event bus

`src/server/events/bus.ts` defines `EventBus`. The production
implementation maps each session to the NATS subject
`arimaa.sessions.<id>`. Each message is JSON-encoded. The WebSocket
route subscribes to the relevant subject on connection and
drains/unsubscribes when the client disconnects.

NATS core (no JetStream) is used because persistence is not needed
-- the transcript is the durable record; the event bus is only for
live push delivery. Any WebSocket client that was offline during a
move will catch up by receiving the transcript from the REST API on
reconnect.

The in-memory `InMemoryEventBus` lets server tests assert on
WebSocket delivery without any NATS infrastructure.

---

## Email delivery

`src/server/email/sender.ts` defines `EmailSender` and ships three
implementations:

- `SmtpEmailSender` -- production. Wraps nodemailer's SMTP transport.
  Configured via `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
  `SMTP_FROM`, `SMTP_SECURE` environment variables.
- `ConsoleEmailSender` -- dev fallback. Prints the rendered email to
  stdout. The composition root selects this automatically when
  `SMTP_HOST` is unset, so a fresh checkout works without an MTA
  (the verification URL is just printed to the API container's logs).
- `RecordingEmailSender` -- tests. Keeps the emails in memory so
  tests can extract verification / reset tokens from the rendered
  body and complete the round-trip.

Templates (`src/server/email/templates.ts`) produce both `text` and
`html` bodies for every email so MUAs that prefer plaintext always
have a readable view.

---

## Server route organisation

The Fastify factory (`src/server/server.ts`) is a thin composition
root. Each concern lives in its own file under `src/server/routes/`:

| File | Responsibility |
|---|---|
| `routes/auth.ts` | login, refresh-token exchange, logout |
| `routes/users.ts` | register, get/delete `users/me`, resend verify, change password |
| `routes/email.ts` | confirm verification token |
| `routes/passwords.ts` | request + complete password reset |
| `routes/sessions.ts` | create / get / accept / move / list |
| `routes/ws.ts` | WebSocket subscription |

`server.ts` registers every module with the same `RouteDeps` bundle,
so test composition (in-memory fakes) and production composition
(Postgres + NATS + SMTP) differ only at the edges.

---

## Frontend architecture

### Routing

[TanStack Router](https://tanstack.com/router) with code-based route
configuration. The route tree is split into two layouts:

- The **app area** (under `AppShell`) -- `/`, `/offline`,
  `/sessions/:id`, `/preferences`. Renders the heading, the user
  menu, and the tab strip. The Preferences page is in the shell but
  is not a tab itself.
- The **auth area** (no `AppShell`) -- `/login`, `/register`,
  `/forgot-password`, `/reset-password`, `/verify-email`,
  `/login-pending`. These render with the smaller `AuthLayout` chrome.

### Network adapters

`src/network/` is split into two API clients plus storage:

- `authApi.ts` -- `AuthApiClient` interface + `HttpAuthApiClient`.
- `gameApi.ts` -- `GameSessionApiClient` interface + `HttpGameSessionApiClient`.
- `authStorage.ts` -- `AuthStorage` interface + `LocalStorageAuthStorage`
  (and a `MemoryAuthStorage` for tests).
- `socket.ts` -- `SessionSocket` interface + `WebSocketSessionSocket`.
- `fake.ts` -- in-memory `FakeAuthApiClient` and `FakeGameSessionApiClient`
  that share state for component tests.

The `NetworkProvider` exposes the three transport adapters
(`authApi`, `gameApi`, `socket`) on a React context. Auth-flow state
(current user, access token, sign-in pending state) lives in a
separate `AuthProvider` keyed off `useAuth()` -- see
[docs/auth.md](./auth.md) for that state machine.

### LocalStorage scope

The browser persists exactly one blob, keyed `arimaatic.auth.v1`:

```ts
{ version: 1, refreshToken, refreshTokenExpiresAt, user }
```

The previous iteration of this app stored a list of game records
locally. That list is now retrieved from
`GET /api/users/me/sessions`, so the localStorage footprint shrinks
to "what does the server need to recognise me again". The legacy
`arimaatic.games` key is removed on every signout for safety.

### Login menu and preferences

The page chrome renders a `UserMenu` (`src/components/UserMenu.tsx`)
in place of the old About button. When the user is signed in, the
trigger shows their username next to a profile icon and the dropdown
contains a Preferences button and a red Sign-out button. When signed
out, the trigger says "Login" and the dropdown contains a blue Sign-
in button. The dropdown also carries the migrated About content
(project info, GitHub link, asset credits).

The `/preferences` page (`src/components/PreferencesPage.tsx`)
shows read-only profile fields (username, email, joined, last
sign-in) and a Delete-Account button. Confirmation pops a modal
warning; on confirmation we call `DELETE /api/users/me` and sign the
user out.

### NetworkGameView

`src/components/games/NetworkGameView.tsx` owns a local `ArimaaGame`
engine seeded from the server's transcript so the existing Board /
ControllerPanel components can be reused without any API knowledge
of their own. The viewer's role is derived by comparing the auth
context user id against the snapshot's `participants.gold.userId` /
`silver.userId`. Move submission uses the auth context's access
token; spectators (anonymous or just not-on-this-game) see a
read-only board.

The flow for submitting a turn:

1. The player makes moves locally. The engine applies them as a
   preview (steps appear on the board immediately).
2. On "Submit Turn", the component assembles the move notation and
   POSTs to `/api/sessions/:id/moves` with the access token.
3. **If the server accepts**: `adoptSnapshot(response.snapshot)`
   replaces the local engine.
4. **If the server rejects**: the component loops
   `game.undoVisibleStep()` until there is nothing left to undo,
   restoring the local engine to the server's last-known position.

The WebSocket-based snapshot adoption logic
(`shouldAdoptSnapshot` in `snapshotAdoption.ts`) only reseeds the
engine when either the transcript or the status differs from the
current snapshot -- so duplicate "echo" events for the user's own
move don't trash the in-progress preview.

---

## Testing strategy

### Server: bun:test + in-memory fakes

`src/server/tests/server.test.ts` runs the Fastify server with
`buildInMemoryDataStore()`, `InMemoryEventBus`, and
`RecordingEmailSender`. No PostgreSQL, NATS, or SMTP is needed. The
test suite uses Fastify's `inject` API for HTTP and `app.listen({port:
0})` for WebSocket assertions. Coverage:

- Registration (uniqueness, fallback usernames, weak passwords)
- Login (credential checks, no enumeration leak, email/username login)
- Refresh-token exchange (account-not-activated, account-disabled,
  invalid)
- Email verification round-trip
- Password-reset round-trip + refresh-token revocation
- Account deletion preserves session FKs as null
- Session create / accept / move / list (with ownership checks)
- WebSocket event delivery after a move

### Frontend network fake: bun:test

`src/network/fake.test.ts` exercises the `FakeAuthApiClient` and
`FakeGameSessionApiClient` directly so a regression in the test
double does not silently corrupt component-level tests downstream.

### Component tests: bun:test + happy-dom + Testing Library

`src/components/auth/AuthFlow.test.tsx` mounts the auth-area screens
inside a memory-history TanStack Router and exercises them with
real DOM events. Setup is a one-line preload (`bunfig.toml` →
`src/test-preload.ts`) that registers happy-dom globals before
`@testing-library/dom` captures `document.body`.

### UI smoke / responsive: Playwright

`tests/ui/` contains end-to-end tests against the running Vite dev
server. These test the offline game board (move execution, undo,
export/import) and the responsive layout on multiple viewport
projects. They do not yet drive the networked path; the auth-area
screens are covered by the component-level tests above.

Run all checks:

```sh
bun run test       # bun:test (engine + server + fakes + auth components)
bun run test:ui    # Playwright (offline UI + responsive layout)
bun run build      # TypeScript + Vite
bun run lint       # ESLint + Biome
```
