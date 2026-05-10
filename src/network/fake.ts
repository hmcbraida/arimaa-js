/**
 * In-memory fakes for the network layer.
 *
 * Used by component tests so the React tree exercises the real
 * `AuthApiClient` and `GameSessionApiClient` interfaces without
 * needing a backend. The fake state is shared across the two clients
 * (returned together by `buildFakeNetwork`) so a registration through
 * `auth.registerUser` populates the user list that `auth.login` reads.
 *
 * The fake is intentionally not a perfect simulation --  it skips
 * password hashing (stores plaintext), uses simple sequential ids,
 * and serves emails through a local recorder. Tests that need a
 * particular failure mode (account-not-activated, account-disabled,
 * etc.) reach into the state directly rather than driving it from
 * the public API.
 */

import type {
  AcceptSessionRequest,
  AcceptSessionResponse,
  CompletePasswordResetRequest,
  CreateSessionResponse,
  CreateUserRequest,
  CreateUserResponse,
  EmptyResponse,
  GetSessionAcceptTokenResponse,
  GetSessionResponse,
  ListUserSessionsQuery,
  ListUserSessionsResponse,
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  RefreshAccessTokenRequest,
  RefreshAccessTokenResponse,
  RequestPasswordResetRequest,
  SessionListEntry,
  SessionParticipant,
  SessionSnapshot,
  Side,
  SubmitMoveRequest,
  SubmitMoveResponse,
  UserProfile,
} from "../shared/schema";
import { ApiError } from "./api";
import type { AuthApiClient } from "./authApi";
import type { GameSessionApiClient } from "./gameApi";

/* --------------------------------------------------------------------- */
/* Internal state shapes                                                 */
/* --------------------------------------------------------------------- */

interface FakeUser {
  id: string;
  username: string;
  password: string;
  emailAddress: string;
  rCreated: string;
  lastLogin: string | null;
  isActivated: boolean;
  isDisabled: boolean;
}

interface FakeRefreshToken {
  token: string;
  userId: string;
  revoked: boolean;
}

interface FakeSession {
  id: string;
  goldUserId: string | null;
  silverUserId: string | null;
  acceptToken: string | null;
  pendingSide: Side | null;
  status: "waiting" | "gold" | "silver" | "completed";
  createdAt: string;
  updatedAt: string;
}

export interface RecordedEmail {
  to: string;
  subject: string;
  body: string;
  /** Convenience: the verification or reset token, if extractable. */
  token?: string;
}

/**
 * Shared mutable state. Both fake clients read and write this object.
 */
export class FakeNetworkState {
  users: FakeUser[] = [];
  refreshTokens: FakeRefreshToken[] = [];
  emailVerificationTokens: Map<string, string> = new Map(); // token → userId
  passwordResetTokens: Map<string, string> = new Map();
  sessions: FakeSession[] = [];
  emails: RecordedEmail[] = [];
  /**
   * The single access token issued by `tryIssueAccessToken`. The fake
   * accepts any string passed as `accessToken` for simplicity; we keep
   * a record only so tests that want to assert it received one can.
   */
  lastAccessToken: string | null = null;
  /** Sequential id counter, used to generate UUIDs deterministically. */
  private nextId = 1;

  newId(): string {
    const n = String(this.nextId++).padStart(12, "0");
    // Format like a UUID so anything that calls z.uuid() still parses.
    return `00000000-0000-4000-8000-${n}`;
  }

  newToken(prefix: string): string {
    return `${prefix}-${String(this.nextId++).padStart(8, "0")}`;
  }
}

/* --------------------------------------------------------------------- */
/* Auth fake                                                             */
/* --------------------------------------------------------------------- */

/**
 * Translate a `FakeUser` into the wire `UserProfile`.
 */
function userToProfile(u: FakeUser): UserProfile {
  return {
    id: u.id,
    username: u.username,
    emailAddress: u.emailAddress,
    rCreated: u.rCreated,
    lastLogin: u.lastLogin,
    isActivated: u.isActivated,
    isDisabled: u.isDisabled,
  };
}

/**
 * Issue a fresh refresh + (maybe) access token bundle.
 */
function issueBundle(
  state: FakeNetworkState,
  user: FakeUser,
): {
  refreshToken: string;
  refreshTokenExpiresAt: string;
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
} {
  const refreshToken = state.newToken("rt");
  state.refreshTokens.push({
    token: refreshToken,
    userId: user.id,
    revoked: false,
  });
  const refreshTokenExpiresAt = new Date(
    Date.now() + 365 * 24 * 60 * 60 * 1000,
  ).toISOString();
  if (!user.isActivated || user.isDisabled) {
    return {
      refreshToken,
      refreshTokenExpiresAt,
      accessToken: null,
      accessTokenExpiresAt: null,
    };
  }
  const accessToken = state.newToken("at");
  state.lastAccessToken = accessToken;
  user.lastLogin = new Date().toISOString();
  return {
    refreshToken,
    refreshTokenExpiresAt,
    accessToken,
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

/**
 * Find the user owning a given access token. The fake does not do
 * any signature verification --  it remembers the last issued token and
 * allows everyone to use it. Tests that need precise scope control
 * should use distinct user-owned tokens via separate logins.
 */
function userForAccessToken(
  state: FakeNetworkState,
  accessToken: string,
): FakeUser | null {
  // The fake tags access tokens with the user id when it issues them.
  // Old "lastAccessToken" tracking is only used for assertion ergonomics
  // --  the actual mapping is in the prefix.
  for (const rt of state.refreshTokens) {
    // If there is exactly one user, return them; otherwise we look up
    // by stash because we issue at most one access token at a time
    // anyway.
    void rt;
  }
  // We store the access token's owner inside the token string itself so
  // multiple users in a test do not get confused. Format: at-NNNNN-userid.
  const parts = accessToken.split("|");
  if (parts.length !== 2) {
    // Fall back to the most-recently-active user --  fine for single-user
    // tests, which are the common case.
    return state.users[state.users.length - 1] ?? null;
  }
  const userId = parts[1];
  return state.users.find((u) => u.id === userId) ?? null;
}

export class FakeAuthApiClient implements AuthApiClient {
  public constructor(private readonly state: FakeNetworkState) {}

  async registerUser(body: CreateUserRequest): Promise<CreateUserResponse> {
    const { username } = body;
    const collision = this.state.users.find(
      (u) =>
        u.username.toLowerCase() === username.toLowerCase() ||
        u.emailAddress.toLowerCase() === body.emailAddress.toLowerCase(),
    );
    if (collision !== undefined) {
      const field =
        collision.username.toLowerCase() === username.toLowerCase()
          ? "username"
          : "email";
      throw new ApiError(
        409,
        `That ${field} is already in use`,
        `${field}-taken`,
      );
    }
    const user: FakeUser = {
      id: this.state.newId(),
      username,
      password: body.password,
      emailAddress: body.emailAddress.toLowerCase(),
      rCreated: new Date().toISOString(),
      lastLogin: null,
      isActivated: false,
      isDisabled: false,
    };
    this.state.users.push(user);
    const bundle = issueBundle(this.state, user);
    // Bake the user id into the access token so multi-user tests can
    // disambiguate ownership.
    if (bundle.accessToken !== null) {
      bundle.accessToken = `${bundle.accessToken}|${user.id}`;
    }
    return { user: userToProfile(user), ...bundle };
  }

  async login(body: LoginRequest): Promise<LoginResponse> {
    const u = this.state.users.find(
      (u) =>
        u.username.toLowerCase() === body.usernameOrEmail.toLowerCase() ||
        u.emailAddress.toLowerCase() === body.usernameOrEmail.toLowerCase(),
    );
    if (u === undefined || u.password !== body.password) {
      throw new ApiError(
        401,
        "Invalid username or password",
        "invalid-credentials",
      );
    }
    const bundle = issueBundle(this.state, u);
    if (bundle.accessToken !== null) {
      bundle.accessToken = `${bundle.accessToken}|${u.id}`;
    }
    return { user: userToProfile(u), ...bundle };
  }

  async refreshAccessToken(
    body: RefreshAccessTokenRequest,
  ): Promise<RefreshAccessTokenResponse> {
    const row = this.state.refreshTokens.find(
      (rt) => rt.token === body.refreshToken && !rt.revoked,
    );
    if (row === undefined) return { ok: false, reason: "invalid", user: null };
    const u = this.state.users.find((u) => u.id === row.userId);
    if (u === undefined) return { ok: false, reason: "invalid", user: null };
    if (u.isDisabled) {
      return { ok: false, reason: "account-disabled", user: userToProfile(u) };
    }
    if (!u.isActivated) {
      return {
        ok: false,
        reason: "account-not-activated",
        user: userToProfile(u),
      };
    }
    const accessToken = `${this.state.newToken("at")}|${u.id}`;
    this.state.lastAccessToken = accessToken;
    u.lastLogin = new Date().toISOString();
    return {
      ok: true,
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      user: userToProfile(u),
    };
  }

  async logout(body: LogoutRequest): Promise<EmptyResponse> {
    const row = this.state.refreshTokens.find(
      (rt) => rt.token === body.refreshToken,
    );
    if (row !== undefined) row.revoked = true;
    return {};
  }

  async getProfile(accessToken: string): Promise<UserProfile> {
    const u = userForAccessToken(this.state, accessToken);
    if (u === null) throw new ApiError(401, "unauthorized");
    return userToProfile(u);
  }

  async deleteAccount(accessToken: string): Promise<EmptyResponse> {
    const u = userForAccessToken(this.state, accessToken);
    if (u === null) throw new ApiError(401, "unauthorized");
    // Cascade: drop tokens, null session FKs, drop user.
    this.state.refreshTokens = this.state.refreshTokens.filter(
      (rt) => rt.userId !== u.id,
    );
    for (const s of this.state.sessions) {
      if (s.goldUserId === u.id) s.goldUserId = null;
      if (s.silverUserId === u.id) s.silverUserId = null;
    }
    this.state.users = this.state.users.filter((other) => other.id !== u.id);
    return {};
  }

  async resendVerificationEmail(refreshToken: string): Promise<EmptyResponse> {
    const row = this.state.refreshTokens.find(
      (rt) => rt.token === refreshToken && !rt.revoked,
    );
    if (row === undefined) {
      throw new ApiError(401, "Invalid refresh token", "invalid-token");
    }
    const u = this.state.users.find((u) => u.id === row.userId);
    if (u === undefined) throw new ApiError(401, "unauthorized");
    if (u.isDisabled)
      throw new ApiError(401, "Account is disabled", "account-disabled");
    if (u.isActivated) return {};
    const token = this.state.newToken("ev");
    this.state.emailVerificationTokens.set(token, u.id);
    this.state.emails.push({
      to: u.emailAddress,
      subject: "Confirm your Arimaatic email address",
      body: `verify token=${encodeURIComponent(token)}`,
      token,
    });
    return {};
  }

  async confirmEmail(token: string): Promise<EmptyResponse> {
    const userId = this.state.emailVerificationTokens.get(token);
    if (userId === undefined) {
      throw new ApiError(
        404,
        "Verification token is invalid or expired",
        "verification-invalid",
      );
    }
    this.state.emailVerificationTokens.delete(token);
    const u = this.state.users.find((u) => u.id === userId);
    if (u !== undefined) u.isActivated = true;
    return {};
  }

  async requestPasswordReset(
    body: RequestPasswordResetRequest,
  ): Promise<EmptyResponse> {
    const u = this.state.users.find(
      (u) => u.emailAddress.toLowerCase() === body.emailAddress.toLowerCase(),
    );
    if (u === undefined) return {};
    const token = this.state.newToken("pr");
    this.state.passwordResetTokens.set(token, u.id);
    this.state.emails.push({
      to: u.emailAddress,
      subject: "Reset your Arimaatic password",
      body: `reset token=${encodeURIComponent(token)}`,
      token,
    });
    return {};
  }

  async completePasswordReset(
    token: string,
    body: CompletePasswordResetRequest,
  ): Promise<EmptyResponse> {
    const userId = this.state.passwordResetTokens.get(token);
    if (userId === undefined) {
      throw new ApiError(
        404,
        "Reset token is invalid or expired",
        "reset-invalid",
      );
    }
    this.state.passwordResetTokens.delete(token);
    const u = this.state.users.find((u) => u.id === userId);
    if (u !== undefined) {
      u.password = body.newPassword;
      // Revoke all outstanding refresh tokens for this user.
      for (const rt of this.state.refreshTokens) {
        if (rt.userId === u.id) rt.revoked = true;
      }
    }
    return {};
  }
}

/* --------------------------------------------------------------------- */
/* Game-session fake                                                     */
/* --------------------------------------------------------------------- */

function buildSnapshot(
  state: FakeNetworkState,
  s: FakeSession,
): SessionSnapshot {
  const goldUser =
    s.goldUserId === null
      ? null
      : (state.users.find((u) => u.id === s.goldUserId) ?? null);
  const silverUser =
    s.silverUserId === null
      ? null
      : (state.users.find((u) => u.id === s.silverUserId) ?? null);
  const participantOf = (u: FakeUser | null): SessionParticipant =>
    u === null ? null : { userId: u.id, username: u.username };
  const sideToMove =
    s.status === "gold" ? "gold" : s.status === "silver" ? "silver" : null;
  return {
    id: s.id,
    status: s.status,
    sideToMove,
    transcript: "1g\n",
    moveLog: [],
    winner: null,
    reason: null,
    participants: {
      gold: participantOf(goldUser),
      silver: participantOf(silverUser),
    },
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export class FakeGameSessionApiClient implements GameSessionApiClient {
  public constructor(private readonly state: FakeNetworkState) {}

  async createSession(args: {
    accessToken: string;
    side: Side;
  }): Promise<CreateSessionResponse> {
    const u = userForAccessToken(this.state, args.accessToken);
    if (u === null) throw new ApiError(401, "unauthorized");
    const id = this.state.newId();
    const acceptToken = String(Math.floor(Math.random() * 1e8)).padStart(
      8,
      "0",
    );
    const session: FakeSession = {
      id,
      goldUserId: args.side === "gold" ? u.id : null,
      silverUserId: args.side === "silver" ? u.id : null,
      acceptToken,
      pendingSide: args.side === "gold" ? "silver" : "gold",
      status: "waiting",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.state.sessions.push(session);
    return {
      sessionId: id,
      side: args.side,
      acceptToken,
      snapshot: buildSnapshot(this.state, session),
    };
  }

  async acceptSession(args: {
    accessToken: string;
    body: AcceptSessionRequest;
  }): Promise<AcceptSessionResponse> {
    const u = userForAccessToken(this.state, args.accessToken);
    if (u === null) throw new ApiError(401, "unauthorized");
    const session = this.state.sessions.find(
      (s) => s.acceptToken === args.body.acceptToken,
    );
    if (session === undefined) {
      throw new ApiError(404, "Accept token is invalid or already used");
    }
    if (session.pendingSide === "gold") session.goldUserId = u.id;
    else if (session.pendingSide === "silver") session.silverUserId = u.id;
    session.acceptToken = null;
    session.pendingSide = null;
    session.status = "gold";
    session.updatedAt = new Date().toISOString();
    const side: Side = session.goldUserId === u.id ? "gold" : "silver";
    return {
      sessionId: session.id,
      side,
      snapshot: buildSnapshot(this.state, session),
    };
  }

  async getSession(sessionId: string): Promise<GetSessionResponse> {
    const session = this.state.sessions.find((s) => s.id === sessionId);
    if (session === undefined) {
      throw new ApiError(404, "Session does not exist");
    }
    return buildSnapshot(this.state, session);
  }

  async getSessionAcceptToken(args: {
    accessToken: string;
    sessionId: string;
  }): Promise<GetSessionAcceptTokenResponse> {
    const u = userForAccessToken(this.state, args.accessToken);
    if (u === null) throw new ApiError(401, "unauthorized");
    const session = this.state.sessions.find((s) => s.id === args.sessionId);
    if (session === undefined) {
      throw new ApiError(404, "Session does not exist");
    }
    if (session.goldUserId !== u.id && session.silverUserId !== u.id) {
      throw new ApiError(403, "You are not a participant in this session");
    }
    return { acceptToken: session.acceptToken };
  }

  async submitMove(_args: {
    accessToken: string;
    sessionId: string;
    body: SubmitMoveRequest;
  }): Promise<SubmitMoveResponse> {
    // The test fake does not exercise the rules engine; tests that
    // need legal-move semantics should use the real server. Instead we
    // simulate a successful submit by toggling whose turn it is.
    const u = userForAccessToken(this.state, _args.accessToken);
    if (u === null) throw new ApiError(401, "unauthorized");
    const session = this.state.sessions.find((s) => s.id === _args.sessionId);
    if (session === undefined) throw new ApiError(404, "Not Found");
    session.status = session.status === "gold" ? "silver" : "gold";
    session.updatedAt = new Date().toISOString();
    return { snapshot: buildSnapshot(this.state, session) };
  }

  async listMySessions(args: {
    accessToken: string;
    query: ListUserSessionsQuery;
  }): Promise<ListUserSessionsResponse> {
    const u = userForAccessToken(this.state, args.accessToken);
    if (u === null) throw new ApiError(401, "unauthorized");
    const mine = this.state.sessions.filter(
      (s) => s.goldUserId === u.id || s.silverUserId === u.id,
    );
    const limit = args.query.limit ?? 20;
    const slice = mine.slice(0, limit);
    const entries: SessionListEntry[] = slice.map((s) => {
      const yourSide: Side = s.goldUserId === u.id ? "gold" : "silver";
      const sideToMove =
        s.status === "gold" ? "gold" : s.status === "silver" ? "silver" : null;
      const whoseTurn =
        sideToMove === null
          ? null
          : sideToMove === yourSide
            ? "you"
            : "opponent";
      const snap = buildSnapshot(this.state, s);
      return {
        id: s.id,
        status: s.status,
        sideToMove,
        yourSide,
        whoseTurn,
        participants: snap.participants,
        winner: null,
        reason: null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    });
    return { sessions: entries, nextCursor: null };
  }
}

/* --------------------------------------------------------------------- */
/* Convenience builder                                                   */
/* --------------------------------------------------------------------- */

export function buildFakeNetwork(): {
  state: FakeNetworkState;
  authApi: FakeAuthApiClient;
  gameApi: FakeGameSessionApiClient;
} {
  const state = new FakeNetworkState();
  return {
    state,
    authApi: new FakeAuthApiClient(state),
    gameApi: new FakeGameSessionApiClient(state),
  };
}
