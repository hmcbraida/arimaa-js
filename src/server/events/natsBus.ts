/**
 * NATS-backed implementation of `EventBus`.
 *
 * Uses NATS core publish/subscribe with one subject per session,
 * `arimaa.sessions.<sessionId>`. The body of each message is the JSON
 * encoding of the `SessionEvent` discriminated union.
 *
 * Why NATS rather than Postgres LISTEN/NOTIFY or Redis Pub/Sub:
 *
 * - We already need a separate event-dispatch component because the
 *   Postgres-only server cannot fan out to multiple API replicas without
 *   it; NATS is the simplest piece of infra that solves that cleanly.
 * - Subjects are cheap and lightweight, so per-session subscriptions cost
 *   essentially nothing.
 * - Reconnection and backpressure are handled by the client library out
 *   of the box.
 */

import {
  type NatsConnection,
  StringCodec,
  type Subscription,
  connect,
} from "nats";
import { type SessionEvent, sessionEventSchema } from "../../shared/schema";
import type { EventBus, SessionEventHandler, Unsubscribe } from "./bus";

/**
 * Build the NATS subject for a session.
 *
 * Keeping subject construction in one helper means that if we later want
 * to add a tenant or environment prefix we only change it here.
 */
function subjectFor(sessionId: string): string {
  return `arimaa.sessions.${sessionId}`;
}

/**
 * Codec used to encode / decode subject payloads. NATS messages are raw
 * bytes; the StringCodec adapts that to UTF-8 strings so we can hand
 * JSON in and out.
 */
const codec = StringCodec();

export class NatsEventBus implements EventBus {
  private constructor(private readonly conn: NatsConnection) {}

  /**
   * Asynchronous factory because connecting to NATS is itself async.
   * Throws if the broker is unreachable; the server entrypoint is
   * expected to surface that as a startup failure rather than continuing
   * with a half-broken event bus.
   */
  public static async create(natsUrl: string): Promise<NatsEventBus> {
    const conn = await connect({ servers: natsUrl });
    return new NatsEventBus(conn);
  }

  async publish(sessionId: string, event: SessionEvent): Promise<void> {
    /**
     * We re-validate the outgoing event here as a belt-and-braces check.
     * The route layer should already have produced a well-formed event,
     * but if a bug ever causes a malformed publish, catching it at the
     * bus boundary is easier to diagnose than seeing zod failures on the
     * client.
     */
    const validated = sessionEventSchema.parse(event);
    this.conn.publish(
      subjectFor(sessionId),
      codec.encode(JSON.stringify(validated)),
    );
  }

  async subscribe(
    sessionId: string,
    handler: SessionEventHandler,
  ): Promise<Unsubscribe> {
    const subscription: Subscription = this.conn.subscribe(
      subjectFor(sessionId),
    );

    /**
     * NATS subscriptions are async iterables. We drive iteration in the
     * background so multiple subscribes can coexist on a single
     * connection. Errors are swallowed for the same reason as in the
     * in-memory bus: a subscriber crashing must not bring down sibling
     * subscriptions.
     */
    void (async () => {
      for await (const message of subscription) {
        try {
          const raw = JSON.parse(codec.decode(message.data)) as unknown;
          const event = sessionEventSchema.parse(raw);
          await handler(event);
        } catch {
          // Drop malformed messages on the floor.
        }
      }
    })();

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      subscription.unsubscribe();
    };
  }

  async close(): Promise<void> {
    // `drain` flushes pending messages and gracefully stops the
    // connection, which is what we want during shutdown.
    await this.conn.drain();
  }
}
