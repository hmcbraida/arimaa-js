import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright starts the Vite app and verifies the real browser integration.
 *
 * The app itself owns no server state, so reusing an existing local server is
 * safe during iterative development.
 */
export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: true,
  use: {
    // Include the Vite base path so relative navigations (e.g. "offline")
    // resolve to the correct sub-path (/arimaatic/offline).
    baseURL: "http://127.0.0.1:5173/arimaatic/",
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun run dev",
    url: "http://127.0.0.1:5173/arimaatic/",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
