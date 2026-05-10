# Authentication & user accounts

This document is the canonical reference for the auth system: which
URLs exist, what they do, what tokens flow over the wire, and how the
frontend makes the user experience match.

---

## Tokens at a glance

| Token | Lifetime | Form | Storage | Purpose |
|---|---|---|---|---|
| Refresh | 1 year | Opaque random string (32 bytes hex-encoded) | SHA-256 hashed in `refresh_tokens` table; plaintext in browser localStorage | Identifies a logged-in session; redeemable for an access token |
| Access | 15 minutes | Signed JWT (HS256) with `sub=userId` | Not persisted server-side; in-memory on the client | Bearer credential for authenticated endpoints |
| Email-verification | 24 hours | Opaque random string | SHA-256 hashed in `email_verification_tokens`; plaintext in the verification email URL | Single-use; activates the user on confirmation |
| Password-reset | 24 hours | Opaque random string | SHA-256 hashed in `password_reset_tokens`; plaintext in the reset email URL | Single-use; rotates the password and revokes all refresh tokens |

The refresh token is opaque (not a JWT) specifically so it can be
revoked individually. Revocation is what makes "log out everywhere"
and "invalidate all sessions on password reset" simple -- both are a
single DB update.

The access token is a JWT specifically so it does NOT need a DB
lookup on every request. Verification is a signature check.

---

## URL map

The endpoints follow a resource-oriented pattern: auth tokens and
sessions are themselves resources you create (`POST`) and revoke
(`DELETE`); paths use nouns rather than verbs.

| Action | Method | Path |
|---|---|---|
| Register / create account | `POST` | `/api/users` |
| Get current user | `GET` | `/api/users/me` |
| Delete account | `DELETE` | `/api/users/me` |
| Change password (authenticated) | `PUT` | `/api/users/me/password` |
| List the user's games (paginated) | `GET` | `/api/users/me/sessions` |
| Resend verification email | `POST` | `/api/users/me/email/verification` |
| Confirm email | `POST` | `/api/email-verifications/{token}` |
| Login (obtain refresh token) | `POST` | `/api/auth/login-sessions` |
| Refresh access token | `POST` | `/api/auth/login-sessions/current/refresh-tokens` |
| Logout (revoke refresh token) | `DELETE` | `/api/auth/login-sessions/current` |
| Request password reset | `POST` | `/api/passwords/resets` |
| Complete password reset | `POST` | `/api/passwords/resets/{token}` |

Every authenticated endpoint takes its credential as `Authorization:
Bearer <accessToken>`, except for `/api/users/me/email/verification`
(which takes the *refresh* token in the body -- see below) and the
`/auth/login-sessions/current/refresh-tokens` endpoint (which takes
the refresh token in the body, since it is being redeemed rather
than presented for authorisation).

Why the email-verification resend uses the refresh token: an
unactivated user has a refresh token but cannot exchange it for an
access token until the verification flow completes. Binding the
resend endpoint to the access token would be a chicken-and-egg
problem.

---

## Sign-in state machine (frontend)

The browser tracks one of four states, derived from the auth context:

```
   ┌─────────────┐
   │ anonymous   │  no refresh token in localStorage
   └──────┬──────┘
          │ user signs in / registers
          ▼
   ┌─────────────┐
   │ loading     │  attempting to redeem refresh token for access token
   └──┬───────┬──┘
      │       │
      │       │ ok=true → cache access token; refresh on a timer
      │       ▼
      │  ┌───────────────┐
      │  │ authenticated │  full app access
      │  └───────────────┘
      │
      │ ok=false (account-not-activated, account-disabled)
      ▼
   ┌─────────────┐
   │ pending     │  show LoginPendingScreen
   └─────────────┘
```

The `pending` state is the "stuck on login" screen the spec asked
for. Two reason codes are surfaced:

- `account-not-activated` -- the user has not yet clicked the link in
  the verification email. The screen offers a Resend button and a
  Try-again button (both work without leaving the page).
- `account-disabled` -- administrative lock. Only Cancel sign-in is
  offered.

`account-not-activated` and `account-disabled` are NOT collapsed
together: the frontend renders distinct copy for each. A third
reason, `invalid`, is the catch-all for "the refresh token is no
longer usable" (expired, revoked, or unknown), and we deliberately
fold those three cases into one to avoid letting an attacker probe
which is which.

---

## Account-creation flow

```
  Browser                          Server
  ────────                         ───────
  POST /api/users
       { username?, email, pwd }   →
                                   ← 200 { user, refreshToken,
                                          accessToken: null }

  store refresh token
  state: pending(account-not-activated)

  POST /api/users/me/email/verification
       { refreshToken }            →
                                   ← 200 (email queued)

  user clicks verification URL
  → POST /api/email-verifications/{token}
                                   ← 200

  POST /api/auth/login-sessions/current/refresh-tokens
       { refreshToken }            →
                                   ← 200 { accessToken, ... }

  state: authenticated
```

The frontend automatically fires the resend call right after a
successful registration so the verification email appears without
manual intervention. The screen still surfaces a Resend button in
case the email is delayed.

---

## Login flow

```
  POST /api/auth/login-sessions
       { usernameOrEmail, pwd }    →
                                   ← 200 { user, refreshToken,
                                          accessToken | null,
                                          accessTokenExpiresAt }
```

The server runs a constant-time argon2id comparison even when the
user does not exist, so an unknown-user response cannot be
distinguished from a wrong-password response by timing.

If the account is unactivated or disabled, `accessToken` is `null`
and the frontend lands on the pending screen exactly as it would
after registration.

---

## Refresh-token exchange

```
  POST /api/auth/login-sessions/current/refresh-tokens
       { refreshToken }            →
                                   ← 200 { ok: true,  accessToken, … }
                                          { ok: false, reason, user? }
```

The exchange endpoint always returns 200, with a discriminated
payload, because the calling state isn't an error per se -- it's
telling the frontend "you have a refresh token but cannot use it
right now". HTTP 401 is reserved for "the bearer credential I just
gave you is not valid".

A successful exchange also calls `users.touchLastLogin` so the
profile's `lastLogin` reflects the most recent successful access-
token issuance, not just any login.

---

## Password change vs. password reset

There are two separate flows:

**Change** -- authenticated. The user proves they know their current
password and chooses a new one. We revoke all refresh tokens to
force a fresh login on every other device.

```
  PUT /api/users/me/password
      Authorization: Bearer <accessToken>
      { currentPassword, newPassword }
                                   ← 200 (or 403 if currentPassword wrong)
```

**Reset** -- anonymous. The user has forgotten their password and
asks for a one-time link sent to their email. The reset is its own
resource: you create one (`POST /api/passwords/resets`) then fulfil
it (`POST /api/passwords/resets/{token}`).

```
  POST /api/passwords/resets
       { emailAddress }            →
                                   ← 200 (always; no enumeration leak)

  POST /api/passwords/resets/{token}
       { newPassword }             →
                                   ← 200 (or 404 if token invalid)
```

A successful reset revokes every outstanding refresh token for the
user, on the assumption that the user requested a reset because
their old password was compromised.

---

## Game-session ownership

Sessions used to be authenticated with a per-side opaque secret.
Now ownership is by user id:

| Column | Old | New |
|---|---|---|
| `gold_token_hash` | per-session hex | (removed) |
| `silver_token_hash` | per-session hex | (removed) |
| `gold_user_id` | (n/a) | FK → users.id, ON DELETE SET NULL |
| `silver_user_id` | (n/a) | FK → users.id, ON DELETE SET NULL |

The accept-token mechanism is unchanged: an 8-digit code generated
at create time, hashed in the DB, single-use. The difference is
that the joining player is now identified by their authenticated
user id rather than by a freshly-generated per-side secret.

`ON DELETE SET NULL` means deleting an account preserves their
games' history while anonymising their side. This is important
because a deleted account's opponent should still be able to see
the games they played.

---

## Anonymous spectating

The public `GET /api/sessions/:id` and the WebSocket subscription
remain unauthenticated. A signed-out browser visiting a session URL
sees the same read-only board it always did. Move submission still
requires an access token, and the server cross-checks the JWT
subject against the session's gold/silver user-id columns.

---

## Code layout

```
src/server/
├── auth/
│   ├── tokens.ts        signer/verifier, opaque token helpers, TTL constants
│   ├── passwords.ts     argon2id wrappers around Bun.password
│   ├── middleware.ts    extractBearerToken / requireAccessToken (AuthError)
│   └── issue.ts         issueRefreshToken / tryIssueAccessToken / userRecordToProfile
├── email/
│   ├── sender.ts        EmailSender interface + SMTP / Console / Recording impls
│   └── templates.ts     verification + reset email bodies (text + HTML)
├── persistence/
│   ├── store.ts         abstract interfaces (UserStore, RefreshTokenStore, etc.)
│   ├── memoryStore.ts   in-memory test fakes
│   ├── postgresStore.ts production Drizzle-backed implementations
│   └── schema.ts        Drizzle table definitions
└── routes/
    ├── auth.ts          login / refresh / logout
    ├── users.ts         register / me / delete me / resend verify / change password
    ├── email.ts         confirm verification token
    ├── passwords.ts     request reset / complete reset
    ├── sessions.ts      create / list / accept / move
    └── ws.ts            WebSocket subscription

src/auth/
├── AuthProvider.tsx     React provider + state machine
├── authContextValue.ts  context object + types
└── useAuth.ts           hook

src/network/
├── api.ts          shared ApiError + parseOrThrow
├── authApi.ts      AuthApiClient interface + HTTP impl
├── gameApi.ts      GameSessionApiClient interface + HTTP impl
├── authStorage.ts  AuthStorage (localStorage + memory impls)
└── fake.ts         FakeAuthApiClient + FakeGameSessionApiClient for tests
```
