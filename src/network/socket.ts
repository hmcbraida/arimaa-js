/**
 * Browser-side websocket client for the session event stream.
 *
 * Like the HTTP API client, this module starts with a thin interface so
 * UI code does not depend on the `WebSocket` global directly. The
 * production implementation opens a real socket; the fake equivalent
 * (`socketFake.ts`) drives events from an in-memory queue.
 *
 * Each frame is parsed through the shared `sessionEventSchema` before
 * being delivered to the consumer. Frames that fail validation are
 * dropped silently — a defensive choice so a malformed message can
 * never crash the React tree.
 */

import { type SessionEvent, sessionEventSchema } from "../shared/schema";

/**
 * Disposer returned by `subscribe`. Idempotent.
 */
export type SocketUnsubscribe = () => void;

/**
 * Handler for one incoming validated event.
 */
export type SocketEventHandler = (event: SessionEvent) => void;

/**
 * Public interface. The API is intentionally tiny: one method,
 * `subscribe`, that connects, listens, and returns a disposer. There
 * is no separate `connect` / `disconnect` because the lifecycle is
 * always tied to a single React effect.
 */
export interface SessionSocket {
  subscribe(sessionId: string, handler: SocketEventHandler): SocketUnsubscribe;
}

/**
 * Production implementation. Opens a real `WebSocket` per subscription.
 *
 * `baseUrl` is the HTTP origin (e.g. `http://api:3001`) — we derive the
 * `ws://` or `wss://` URL from it. The default of empty string means
 * "same origin as the page" which is the case behind nginx.
 */
export class WebSocketSessionSocket implements SessionSocket {
  public constructor(private readonly httpBaseUrl: string = "") {}

  subscribe(sessionId: string, handler: SocketEventHandler): SocketUnsubscribe {
    const wsUrl = this.deriveWsUrl(sessionId);
    const socket = new WebSocket(wsUrl);

    const onMessage = (event: MessageEvent<string>) => {
      try {
        const raw: unknown = JSON.parse(event.data);
        const parsed = sessionEventSchema.parse(raw);
        handler(parsed);
      } catch {
        // Drop malformed frames silently. Logging would be nice in
        // production; we keep the surface lean for now.
      }
    };
    socket.addEventListener("message", onMessage);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      socket.removeEventListener("message", onMessage);
      // Use close(1000, ...) for a normal closure — the server side
      // simply unsubscribes on close events.
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
    };
  }

  /**
   * Translate the HTTP base URL into a WS URL with the session id
   * passed via query string.
   *
   * If `httpBaseUrl` is empty we read `window.location.origin` so the
   * SPA's deployed origin works regardless of port or protocol.
   */
  private deriveWsUrl(sessionId: string): string {
    const base =
      this.httpBaseUrl.length === 0 ? window.location.origin : this.httpBaseUrl;
    const url = new URL(base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/api/ws";
    url.searchParams.set("sessionId", sessionId);
    return url.toString();
  }
}
