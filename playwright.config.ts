import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright starts the Vite app and verifies the real browser integration.
 *
 * The app itself owns no server state, so reusing an existing local server is
 * safe during iterative development.
 *
 * Projects
 * --------
 * Every project runs the full test suite. The smoke tests verify that game
 * interactions work correctly; the responsive tests verify that each viewport
 * renders without horizontal overflow, keeps the board within bounds, and
 * meets minimum touch-target sizes. Failures on a mobile project indicate a
 * layout regression at that viewport.
 *
 * Viewports covered:
 *   chromium            — 1280×720 desktop baseline
 *   pixel-7             — 412×915 (portrait) — common Android flagship
 *   pixel-7-landscape   — 915×412 — landscape phone, stress-tests the board height
 *   iphone-se           — 375×667 — narrowest mainstream iOS device
 *   ipad                — 810×1080 — mid-size tablet portrait
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
    {
      name: "pixel-7",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "pixel-7-landscape",
      use: { ...devices["Pixel 7 landscape"] },
    },
    {
      name: "iphone-se",
      // devices["iPhone SE"] defaults to WebKit, which requires Ubuntu system
      // libraries not available on Arch. Override to Chromium; viewport,
      // deviceScaleFactor, isMobile, and touch emulation are unchanged.
      use: { ...devices["iPhone SE"], defaultBrowserType: "chromium" },
    },
    {
      name: "ipad",
      // Same WebKit/Arch constraint as iphone-se above.
      use: { ...devices["iPad (gen 7)"], defaultBrowserType: "chromium" },
    },
  ],
});
