import { type Locator, type Page, expect, test } from "@playwright/test";

/**
 * Responsive layout checks for all configured Playwright viewports.
 *
 * These tests encode the minimum visual contract for every screen size:
 *
 *   1. No horizontal overflow — the page must not grow wider than the
 *      viewport. Horizontal scrollbars are the most common sign of a
 *      broken mobile layout.
 *
 *   2. Board within viewport — the board section must not bleed past
 *      the right edge of the visible area.
 *
 *   3. Touch target sizes — interactive elements must meet the 44 × 44 px
 *      minimum recommended by Apple HIG and WCAG 2.5.5. Board squares and
 *      action buttons are checked because they are the primary interaction
 *      surface on a touch device.
 *
 * The same test file runs against every project in playwright.config.ts.
 * Failures on mobile projects identify exactly which viewport breaks a
 * given constraint.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Asserts that the document has no horizontal overflow.
 *
 * Compares scrollWidth (the total rendered width including overflow) with
 * clientWidth (the visible viewport width). Any difference means the page is
 * wider than the viewport and a horizontal scrollbar would appear.
 */
async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflows = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflows, "Page must not overflow horizontally").toBe(false);
}

/**
 * Asserts that a located element is entirely within the viewport's horizontal
 * bounds — i.e. its left edge is ≥ 0 and its right edge is ≤ viewport width.
 *
 * This is stricter than Playwright's built-in toBeInViewport(), which passes
 * if any part of the element is visible. We want the whole board on screen
 * without sideways scrolling.
 */
async function assertWithinViewportWidth(
  locator: Locator,
  page: Page,
  label: string,
): Promise<void> {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box, `${label}: bounding box must be obtainable`).not.toBeNull();
  expect(viewport, `${label}: viewport size must be known`).not.toBeNull();
  expect(box!.x, `${label}: left edge must be within viewport`).toBeGreaterThanOrEqual(0);
  expect(
    box!.x + box!.width,
    `${label}: right edge must not exceed viewport width`,
  ).toBeLessThanOrEqual(viewport!.width);
}

/**
 * Asserts that a located element meets the 44 × 44 px minimum touch target.
 *
 * Source: Apple Human Interface Guidelines; WCAG 2.5.5 (AAA) recommends
 * 44 × 44 CSS pixels. This is the threshold below which tap accuracy
 * degrades noticeably on a capacitive touch screen.
 */
async function assertTouchTarget(locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${label}: element must be present`).not.toBeNull();
  expect(box!.width, `${label}: width must be ≥ 44 px`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `${label}: height must be ≥ 44 px`).toBeGreaterThanOrEqual(44);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Responsive layout — offline game page", () => {
  test("has no horizontal overflow", async ({ page }) => {
    await page.goto("offline");
    await assertNoHorizontalOverflow(page);
  });

  /**
   * Board squares must not overflow their CSS Grid column tracks.
   *
   * The failure mode: `min-h-*` on the button can force the element wider
   * than its column track via the `aspect-ratio` transfer (the browser
   * sets width = height when height is constrained). On narrow viewports
   * this makes adjacent squares overlap each other horizontally, which is
   * the visual "horizontal collapse" the user sees.
   *
   * We verify that, reading the squares left-to-right across rank 1, each
   * square starts at or after the right edge of the previous one.
   */
  test("board squares do not overflow their grid column tracks", async ({
    page,
  }) => {
    await page.goto("offline");
    // In the default (gold's perspective, unflipped) layout, file 'a' is the
    // leftmost data column and file 'h' is the rightmost.
    const filesLeftToRight = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
    let prevRight = -Infinity;
    let prevLabel = "left edge";
    for (const file of filesLeftToRight) {
      const sq = `${file}1`;
      const box = await page.getByTestId(`square-${sq}`).boundingBox();
      expect(box, `${sq}: element must be present`).not.toBeNull();
      expect(
        box!.x,
        `${sq} must not overlap ${prevLabel} (right edge at ${prevRight.toFixed(1)}px)`,
      ).toBeGreaterThanOrEqual(prevRight - 1); // 1 px tolerance for sub-pixel rounding
      prevRight = box!.x + box!.width;
      prevLabel = sq;
    }
  });

  test("board section is fully visible within viewport width", async ({
    page,
  }) => {
    await page.goto("offline");
    const board = page.getByRole("region", { name: "Arimaa board" });
    await expect(board).toBeVisible();
    await assertWithinViewportWidth(board, page, "Arimaa board");
  });

  test("action buttons meet 44 × 44 px minimum touch target", async ({
    page,
  }) => {
    await page.goto("offline");
    // These two buttons are the most frequently tapped controls during a game.
    for (const name of ["Step backward", "Submit Turn"]) {
      await assertTouchTarget(
        page.getByRole("button", { name }),
        `"${name}" button`,
      );
    }
  });

  test("board squares meet 44 × 44 px minimum touch target", async ({
    page,
  }) => {
    await page.goto("offline");
    // Sample the four corners and centre — enough to catch track-sizing
    // issues without measuring all 64 squares.
    const sampleSquares = ["a1", "a8", "h1", "h8", "d4", "e5"] as const;
    for (const sq of sampleSquares) {
      await assertTouchTarget(
        page.getByTestId(`square-${sq}`),
        `square-${sq}`,
      );
    }
  });
});

test.describe("Responsive layout — games list page", () => {
  test("has no horizontal overflow", async ({ page }) => {
    await page.goto(".");
    await assertNoHorizontalOverflow(page);
  });
});
