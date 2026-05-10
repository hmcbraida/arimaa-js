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
 * dropped silently -- a defensive choice so a malformed message can
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
 * `apiBase` is the prefix that comes before `/api/ws` in the final URL.
 * Two forms are accepted:
 *
 *   - A path prefix such as `"/arimaatic"` (the production case when the app is
 *     served from a sub-path): the WS URL is built from `window.location.origin`
 *     plus `${apiBase}/api/ws`.
 *   - A full HTTP origin such as `"http://api:3001"` (local dev pointing
 *     directly at the API server): the origin is taken from the value and the
 *     path is `/api/ws`.
 *   - An empty string: same-origin `/api/ws` -- the default for tests and
 *     simple same-origin deployments.
 */
export class WebSocketSessionSocket implements SessionSocket {
  public constructor(private readonly apiBase: string = "") {}

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
      // Use close(1000, ...) for a normal closure -- the server side
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
   * Build the WebSocket URL from `apiBase`.
   *
   * When `apiBase` is an absolute HTTP URL (starts with "http"), derive
   * the origin from it and use `/api/ws` as the path -- this covers the
   * local-dev case where the API runs on a separate port.
   *
   * Otherwise treat `apiBase` as a path prefix on the current origin
   * (e.g. `"/arimaa"` → `wss://<origin>/arimaa/api/ws`). An empty
   * string resolves to the same-origin `/api/ws`.
   */
  private deriveWsUrl(sessionId: string): string {
    let url: URL;
    if (
      this.apiBase.startsWith("http://") ||
      this.apiBase.startsWith("https://")
    ) {
      url = new URL(this.apiBase);
      url.pathname = "/api/ws";
    } else {
      url = new URL(window.location.origin);
      url.pathname = `${this.apiBase}/api/ws`;
    }
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("sessionId", sessionId);
    return url.toString();
  }
}
