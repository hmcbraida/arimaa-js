/**
 * Test-only helper that registers a happy-dom global window before
 * React Testing Library is imported.
 *
 * Bun's `bun:test` runner has no built-in DOM. We pull in
 * `@happy-dom/global-registrator` (which is fast, much faster than
 * jsdom for component-test workloads) and let it monkey-patch the
 * globals before any React component code runs.
 *
 * Importing this module from a `.test.tsx` is the only thing the
 * caller needs to do; the import has the side effect of installing
 * the DOM and is idempotent.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof (globalThis as { document?: unknown }).document === "undefined") {
  GlobalRegistrator.register();
}
