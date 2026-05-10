/**
 * In-memory implementation of `EventBus` used by tests and any non-clustered
 * single-process deployments.
 *
 * The implementation is intentionally trivial: a `Map<sessionId, Set<handler>>`
 * with synchronous fan-out. It honours the contract that calls to a single
 * subscriber are serialized because we `await` each handler before moving on
 * to the next subscriber on the same session.
 *
 * If two API processes ever need to share state, they should use the NATS
 * implementation instead -- this bus has no cross-process visibility.
 */

import type { SessionEvent } from "../../shared/schema";
import type { EventBus, SessionEventHandler, Unsubscribe } from "./bus";

export class InMemoryEventBus implements EventBus {
  private readonly subscribers = new Map<string, Set<SessionEventHandler>>();
  private closed = false;

  async publish(sessionId: string, event: SessionEvent): Promise<void> {
    if (this.closed) {
      throw new Error("EventBus is closed");
    }
    const handlers = this.subscribers.get(sessionId);
    if (handlers === undefined || handlers.size === 0) return;

    /**
     * Snapshot the set before iterating so a handler that calls
     * `unsubscribe` mid-iteration does not corrupt our loop. We `await`
     * each call so a single subscriber sees events in publish order.
     */
    for (const handler of [...handlers]) {
      try {
        await handler(event);
      } catch {
        // We swallow handler errors so one bad subscriber cannot block
        // delivery to siblings or stall the publisher. Production might
        // want structured logging here; for tests, silent drop is fine.
      }
    }
  }

  async subscribe(
    sessionId: string,
    handler: SessionEventHandler,
  ): Promise<Unsubscribe> {
    if (this.closed) {
      throw new Error("EventBus is closed");
    }
    let bucket = this.subscribers.get(sessionId);
    if (bucket === undefined) {
      bucket = new Set();
      this.subscribers.set(sessionId, bucket);
    }
    bucket.add(handler);

    let disposed = false;
    return () => {
      // Idempotent: calling the disposer twice (e.g. close + ws close)
      // must be safe.
      if (disposed) return;
      disposed = true;
      bucket?.delete(handler);
      if (bucket?.size === 0) {
        this.subscribers.delete(sessionId);
      }
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.subscribers.clear();
  }
}
