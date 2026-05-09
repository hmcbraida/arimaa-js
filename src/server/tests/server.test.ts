/**
 * End-to-end tests for the session API server.
 *
 * The tests use Fastify's `inject` API to send simulated HTTP and WebSocket
 * traffic without ever opening a real socket. Persistence and event-bus
 * concerns are wired through the in-memory fakes so the suite stays
 * infra-free, runs in milliseconds, and never depends on machine state.
 *
 * Each test starts from a fresh server instance to keep tests order-
 * independent. The price is one Fastify build per test, but since we
 * never bind a port, that overhead is negligible.
 */

import { ArimaaGame } from "../../game";
import {
  type SessionEvent,
  acceptSessionResponseSchema,
  createSessionResponseSchema,
  errorResponseSchema,
  getSessionResponseSchema,
  sessionEventSchema,
  submitMoveResponseSchema,
} from "../../shared/schema";
import { InMemoryEventBus } from "../events/memoryBus";
import { InMemorySessionStore } from "../persistence/memoryStore";
import { buildServer } from "../server";

/**
 * Build a fresh server backed by in-memory fakes.
 *
 * Returned together with the bus so individual tests can subscribe to
 * events directly when they need to assert publish behavior.
 */
function buildTestServer() {
  const store = new InMemorySessionStore();
  const events = new InMemoryEventBus();
  const app = buildServer({ store, events });
  return { app, store, events };
}

describe("session API", () => {
  describe("POST /api/sessions", () => {
    it("creates a session and returns secret + accept tokens", async () => {
      const { app } = buildTestServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/sessions?side=gold",
      });
      expect(response.statusCode).toBe(200);
      const body = createSessionResponseSchema.parse(response.json());
      expect(body.side).toBe("gold");
      expect(body.acceptToken).toMatch(/^\d{8}$/);
      // Secret token is 32 random bytes hex-encoded → 64 chars.
      expect(body.secretToken).toMatch(/^[0-9a-f]{64}$/);
      await app.close();
    });

    it("rejects an invalid side query parameter", async () => {
      const { app } = buildTestServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/sessions?side=red",
      });
      expect(response.statusCode).toBe(400);
      errorResponseSchema.parse(response.json());
      await app.close();
    });
  });

  describe("GET /api/sessions/:id", () => {
    it("returns waiting status until the opponent joins", async () => {
      const { app } = buildTestServer();
      const created = createSessionResponseSchema.parse(
        (
          await app.inject({
            method: "POST",
            url: "/api/sessions?side=silver",
          })
        ).json(),
      );
      const got = await app.inject({
        method: "GET",
        url: `/api/sessions/${created.sessionId}`,
      });
      const snapshot = getSessionResponseSchema.parse(got.json());
      expect(snapshot.status).toBe("waiting");
      expect(snapshot.sideToMove).toBeNull();
      // Even before any moves are played, the transcript is valid and
      // re-loadable into a default-setup game.
      const game = ArimaaGame.fromTranscript(snapshot.transcript);
      expect(game.getMoveLog()).toHaveLength(0);
      await app.close();
    });

    it("404s for an unknown session id", async () => {
      const { app } = buildTestServer();
      // Valid uuid that we never created.
      const response = await app.inject({
        method: "GET",
        url: "/api/sessions/00000000-0000-0000-0000-000000000000",
      });
      expect(response.statusCode).toBe(404);
      await app.close();
    });
  });

  describe("POST /api/session-accept", () => {
    it("redeems a valid accept token and starts the game", async () => {
      const { app, events } = buildTestServer();
      const created = createSessionResponseSchema.parse(
        (
          await app.inject({
            method: "POST",
            url: "/api/sessions?side=gold",
          })
        ).json(),
      );
      // Subscribe before redeeming so we can observe the `accepted` event.
      const received: SessionEvent[] = [];
      const unsubscribe = await events.subscribe(created.sessionId, (event) => {
        received.push(event);
      });
      const accepted = await app.inject({
        method: "POST",
        url: "/api/session-accept",
        payload: { acceptToken: created.acceptToken },
      });
      expect(accepted.statusCode).toBe(200);
      const accBody = acceptSessionResponseSchema.parse(accepted.json());
      // Creator chose gold, so opponent is silver.
      expect(accBody.side).toBe("silver");
      expect(accBody.sessionId).toBe(created.sessionId);
      // The session should now be in gold's-turn state.
      const snap = getSessionResponseSchema.parse(
        (
          await app.inject({
            method: "GET",
            url: `/api/sessions/${created.sessionId}`,
          })
        ).json(),
      );
      expect(snap.status).toBe("gold");
      expect(snap.sideToMove).toBe("gold");

      // Exactly one accepted event was published.
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        type: "accepted",
        sessionId: created.sessionId,
      });
      sessionEventSchema.parse(received[0]);

      void unsubscribe();
      await app.close();
    });

    it("treats a re-used accept token as a 404", async () => {
      const { app } = buildTestServer();
      const created = createSessionResponseSchema.parse(
        (
          await app.inject({
            method: "POST",
            url: "/api/sessions?side=gold",
          })
        ).json(),
      );
      const first = await app.inject({
        method: "POST",
        url: "/api/session-accept",
        payload: { acceptToken: created.acceptToken },
      });
      expect(first.statusCode).toBe(200);
      const second = await app.inject({
        method: "POST",
        url: "/api/session-accept",
        payload: { acceptToken: created.acceptToken },
      });
      expect(second.statusCode).toBe(404);
      await app.close();
    });

    it("rejects malformed accept tokens with a 400", async () => {
      const { app } = buildTestServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/session-accept",
        payload: { acceptToken: "not-a-code" },
      });
      expect(response.statusCode).toBe(400);
      await app.close();
    });
  });

  describe("POST /api/sessions/:id/moves", () => {
    /**
     * Helper: create a session, accept it with the second player, and
     * return the credentials and id needed by move tests.
     */
    async function provisionGame(
      app: ReturnType<typeof buildTestServer>["app"],
    ): Promise<{
      sessionId: string;
      goldToken: string;
      silverToken: string;
    }> {
      const created = createSessionResponseSchema.parse(
        (
          await app.inject({
            method: "POST",
            url: "/api/sessions?side=gold",
          })
        ).json(),
      );
      const accepted = acceptSessionResponseSchema.parse(
        (
          await app.inject({
            method: "POST",
            url: "/api/session-accept",
            payload: { acceptToken: created.acceptToken },
          })
        ).json(),
      );
      return {
        sessionId: created.sessionId,
        goldToken: created.secretToken,
        silverToken: accepted.secretToken,
      };
    }

    it("accepts a legal move from the side whose turn it is", async () => {
      const { app, events } = buildTestServer();
      const game = await provisionGame(app);

      const received: SessionEvent[] = [];
      const unsubscribe = await events.subscribe(game.sessionId, (event) => {
        received.push(event);
      });

      const move = await app.inject({
        method: "POST",
        url: `/api/sessions/${game.sessionId}/moves`,
        headers: { authorization: `Bearer ${game.goldToken}` },
        payload: { moveNotation: "Ca2n" },
      });
      expect(move.statusCode).toBe(200);
      const body = submitMoveResponseSchema.parse(move.json());
      expect(body.snapshot.status).toBe("silver");
      expect(body.snapshot.moveLog).toHaveLength(1);
      expect(body.snapshot.moveLog[0]?.notation).toBe("Ca2n");

      // The bus should have seen exactly one move event, and not a
      // `completed` event because the game hasn't ended.
      expect(received.map((event) => event.type)).toEqual(["move"]);
      sessionEventSchema.parse(received[0]);

      void unsubscribe();
      await app.close();
    });

    it("rejects a move from the wrong side with 409 conflict", async () => {
      const { app } = buildTestServer();
      const game = await provisionGame(app);
      // Gold should move first; silver attempts a move and is refused.
      const response = await app.inject({
        method: "POST",
        url: `/api/sessions/${game.sessionId}/moves`,
        headers: { authorization: `Bearer ${game.silverToken}` },
        payload: { moveNotation: "ra7s" },
      });
      expect(response.statusCode).toBe(409);
      const err = errorResponseSchema.parse(response.json());
      expect(err.message).toMatch(/not your turn/i);
      await app.close();
    });

    it("rejects an illegal move with 400", async () => {
      const { app } = buildTestServer();
      const game = await provisionGame(app);
      const response = await app.inject({
        method: "POST",
        url: `/api/sessions/${game.sessionId}/moves`,
        headers: { authorization: `Bearer ${game.goldToken}` },
        // Random nonsense notation — not a parseable move.
        payload: { moveNotation: "ZzZ" },
      });
      expect(response.statusCode).toBe(400);
      await app.close();
    });

    it("rejects requests with no bearer token as 401", async () => {
      const { app } = buildTestServer();
      const game = await provisionGame(app);
      const response = await app.inject({
        method: "POST",
        url: `/api/sessions/${game.sessionId}/moves`,
        payload: { moveNotation: "Ca2n" },
      });
      expect(response.statusCode).toBe(401);
      await app.close();
    });

    it("rejects a token that does not belong to the session", async () => {
      const { app } = buildTestServer();
      const game = await provisionGame(app);
      const response = await app.inject({
        method: "POST",
        url: `/api/sessions/${game.sessionId}/moves`,
        headers: { authorization: "Bearer not-a-real-token" },
        payload: { moveNotation: "Ca2n" },
      });
      expect(response.statusCode).toBe(401);
      await app.close();
    });
  });

  describe("WS /api/ws", () => {
    it("forwards move events to subscribed clients", async () => {
      // injectWS requires the server to be listening on an ephemeral port,
      // so we ready() and listen on 0 (any port). We close the app at the
      // end to release it.
      const { app } = buildTestServer();
      await app.listen({ host: "127.0.0.1", port: 0 });

      const created = createSessionResponseSchema.parse(
        (
          await app.inject({
            method: "POST",
            url: "/api/sessions?side=gold",
          })
        ).json(),
      );
      const accepted = acceptSessionResponseSchema.parse(
        (
          await app.inject({
            method: "POST",
            url: "/api/session-accept",
            payload: { acceptToken: created.acceptToken },
          })
        ).json(),
      );

      // Open a websocket and collect every JSON frame the server emits.
      const ws = await app.injectWS(`/api/ws?sessionId=${created.sessionId}`);
      const frames: SessionEvent[] = [];
      const opened = new Promise<void>((resolve) => {
        ws.on("message", (data) => {
          const parsed = sessionEventSchema.parse(
            JSON.parse(data.toString("utf8")),
          );
          frames.push(parsed);
          resolve();
        });
      });

      await app.inject({
        method: "POST",
        url: `/api/sessions/${created.sessionId}/moves`,
        headers: { authorization: `Bearer ${created.secretToken}` },
        payload: { moveNotation: "Ca2n" },
      });

      await opened;
      expect(frames.some((f) => f.type === "move")).toBe(true);

      // Wait for the socket to fully close before tearing down the
      // server, so jest does not see lingering open handles.
      const closed = new Promise<void>((resolve) =>
        ws.on("close", () => resolve()),
      );
      ws.close();
      await closed;

      // Avoid an unused-variable lint: accepted's existence verifies the
      // accept flow succeeded before we even tried to subscribe.
      expect(accepted.sessionId).toBe(created.sessionId);
      await app.close();
    });
  });
});
