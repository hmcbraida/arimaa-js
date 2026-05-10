/**
 * `bun test --preload` target.
 *
 * Bun test runs this file before any test module. We use it to install
 * happy-dom globals so React Testing Library -- whose `screen` helper
 * captures `document.body` at module load time -- sees a real DOM at
 * import resolution.
 *
 * Wired up in `bunfig.toml` (so `bun run test` picks it up
 * automatically).
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof (globalThis as { document?: unknown }).document === "undefined") {
  GlobalRegistrator.register();
}
