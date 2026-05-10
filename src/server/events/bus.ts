/**
 * Event-bus interface for fan-out of session-level events.
 *
 * The Fastify server publishes events whenever a session's state changes
 * (a player accepts an invitation, a move is committed, the game ends).
 * The websocket route subscribes per-session so each connected client
 * receives only the events for the session they are watching.
 *
 * In production this is backed by NATS so multiple API instances can fan
 * out events to clients connected to any one of them; in tests we use a
 * pure-JavaScript implementation so the suite stays infra-free.
 */

import type { SessionEvent } from "../../shared/schema";

/**
 * The disposer returned by `subscribe`.
 *
 * Calling it must be idempotent -- both the websocket close path and the
 * server's graceful shutdown handler may invoke it.
 */
export type Unsubscribe = () => void | Promise<void>;

/**
 * Async handler invoked for each event published to a subscribed session.
 *
 * The bus must serialize calls per subscriber so a slow handler does not
 * cause out-of-order delivery to the same socket. Both implementations in
 * this codebase honour that constraint.
 */
export type SessionEventHandler = (event: SessionEvent) => void | Promise<void>;

/**
 * The abstract event bus.
 *
 * The interface is deliberately small: publish one event to a session,
 * subscribe to one session. We do not expose any "list subscribers" or
 * "drain queue" methods because the websocket layer does not need them
 * and exposing them would tempt route code into reaching past the
 * abstraction.
 */
export interface EventBus {
  /**
   * Publish a single event to all subscribers of `sessionId`.
   *
   * Returns once the event has been accepted by the underlying transport;
   * delivery to the subscribers themselves is asynchronous.
   */
  publish(sessionId: string, event: SessionEvent): Promise<void>;

  /**
   * Subscribe to events for a single session. Returns a disposer.
   */
  subscribe(
    sessionId: string,
    handler: SessionEventHandler,
  ): Promise<Unsubscribe>;

  /**
   * Tear down the bus connection on graceful shutdown.
   *
   * Both implementations are idempotent -- calling close after close is a
   * no-op rather than an error.
   */
  close(): Promise<void>;
}
