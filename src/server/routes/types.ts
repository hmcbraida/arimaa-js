/**
 * Dependency bundle every route module receives.
 *
 * Keeping the shape in a single place means each route file imports
 * exactly one type when describing its inputs, and the composition
 * root (`server.ts`) only needs to construct one object.
 *
 * The `now` callback exists so deterministic tests can install a fixed
 * clock; production passes `() => new Date()`.
 *
 * `publicBaseUrl` is the absolute URL the frontend lives at. The
 * server uses it to build email verification and password-reset links
 * -- emails need to be self-contained (a relative URL would not work
 * inside an inbox), and the server is the only component that knows
 * the routing scheme without ambiguity.
 */

import type { AuthTokenSigner } from "../auth/tokens";
import type { EmailSender } from "../email/sender";
import type { EventBus } from "../events/bus";
import type { DataStore } from "../persistence/store";

export interface RouteDeps {
  readonly store: DataStore;
  readonly events: EventBus;
  readonly emailSender: EmailSender;
  readonly tokenSigner: AuthTokenSigner;
  readonly publicBaseUrl: string;
  readonly now: () => Date;
  /**
   * When true, the `refresh_token` cookie is set with `Secure`. Derived from
   * `publicBaseUrl`; false when the URL is http (local dev), true when https
   * (production).
   */
  readonly secureCookies: boolean;
}
