/**
 * WebSocket subscription route.
 *
 * Clients connect to `/api/ws?sessionId=<uuid>`; the server verifies
 * the session exists, subscribes to the relevant subject on the event
 * bus, and forwards each event JSON-encoded to the client.
 *
 * The websocket itself does not require authentication for the same
 * reason `GET /api/sessions/:id` does not: a session id is unguessable
 * UUID, and the read-only event stream is treated as part of the
 * public observation surface. We could add bearer-token query auth
 * here later if private games become a feature.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RouteDeps } from "./types";

export function registerWebSocketRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): void {
  app.register(async (scoped) => {
    scoped.get(
      "/api/ws",
      { websocket: true },
      async (
        socket: import("ws").WebSocket,
        request: FastifyRequest,
      ): Promise<void> => {
        const sessionId = (request.query as { sessionId?: string })?.sessionId;
        if (typeof sessionId !== "string" || sessionId.length === 0) {
          socket.close(1008, "Missing sessionId");
          return;
        }

        const record = await deps.store.sessions.getById(sessionId);
        if (record === null) {
          socket.close(1008, "Unknown session");
          return;
        }

        const unsubscribe = await deps.events.subscribe(sessionId, (event) => {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(event));
          }
        });

        socket.on("close", () => {
          void unsubscribe();
        });
      },
    );
  });
}
