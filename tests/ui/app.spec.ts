import { expect, test } from "@playwright/test";

/**
 * UI smoke tests for the Vite application.
 *
 * These tests verify that the board and controller are wired to the same game
 * instance rather than testing every rule already covered by Jest.
 */
test.describe("Arimaa app", () => {
  test("moves a piece and reflects the step in the controller", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Arimaa" })).toBeVisible();
    await page.getByTestId("square-a2").click();
    await page.getByTestId("square-a3").click();

    await expect(page.getByText("Ca2n")).toBeVisible();
    await expect(
      page.getByTestId("square-a3").getByTestId("piece-C"),
    ).toBeVisible();

    await page.getByRole("button", { name: "Step backward" }).click();

    await expect(page.getByText("Ca2n")).toHaveCount(0);
    await expect(
      page.getByTestId("square-a2").getByTestId("piece-C"),
    ).toBeVisible();
  });

  test("requires manual submission before committing a turn", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByTestId("square-a2").click();
    await page.getByTestId("square-a3").click();
    await page.getByTestId("square-b2").click();
    await page.getByTestId("square-b3").click();
    await page.getByTestId("square-a3").click();
    await page.getByTestId("square-a4").click();
    await page.getByTestId("square-b3").click();
    await page.getByTestId("square-b4").click();

    await expect(page.getByText("Gold 1")).toBeVisible();
    await expect(page.getByText("No completed moves")).toBeVisible();

    await page.getByRole("button", { name: "Submit Turn" }).click();

    await expect(page.getByText("Silver 1")).toBeVisible();
    await expect(page.getByText("No visible steps")).toBeVisible();
    await expect(page.getByText("No completed moves")).toHaveCount(0);
  });

  test("does not expose the hidden finish-turn step", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText(/finish-turn/i)).toHaveCount(0);
    await expect(page.getByText(/end of move/i)).toHaveCount(0);
  });

  test("can convert an ambiguous move into a pull on the next click", async ({
    page,
  }) => {
    await page.goto("/?scenario=pull");

    await page.getByTestId("square-c2").click();
    await page.getByTestId("square-c3").click();

    await expect(page.getByText("Hc2n")).toBeVisible();
    await expect(
      page.getByTestId("square-c1").getByTestId("piece-r"),
    ).toBeVisible();
    await expect(
      page.getByTestId("square-c3").getByTestId("piece-H"),
    ).toHaveCount(0);

    await page.getByTestId("square-c1").click();
    await page.getByTestId("square-c2").click();

    await expect(page.getByText("rc1n")).toBeVisible();
    await expect(
      page.getByTestId("square-c2").getByTestId("piece-r"),
    ).toBeVisible();
    await expect(
      page.getByTestId("square-c3").getByTestId("piece-H"),
    ).toHaveCount(0);
  });
});
