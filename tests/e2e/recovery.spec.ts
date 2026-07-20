import { test, expect } from "@playwright/test";
import { openFixtureProject } from "./helpers";

test.describe("Crash recovery screen (ErrorBoundary)", () => {
  test("a renderer error shows a native recovery screen with reload, restart, and copy actions", async ({ page }) => {
    await openFixtureProject(page);

    // Trigger the ErrorBoundary's window-error handler deterministically,
    // without actually crashing React (which would tear down the harness).
    await page.evaluate(() => {
      window.dispatchEvent(
        new ErrorEvent("error", {
          error: new Error("simulated renderer crash"),
          message: "simulated renderer crash",
        }),
      );
    });

    const card = page.locator(".empty-state.card", { hasText: "Basebuild hit a problem" });
    await expect(card).toBeVisible();
    await expect(card.locator("pre")).toContainText("simulated renderer crash");

    // Every recovery action is present and carries a tooltip (DESIGN.md: every
    // interactive control has a title).
    for (const label of ["Reload app", "Restart Basebuild", "Copy error details"]) {
      const btn = card.getByRole("button", { name: label });
      await expect(btn).toBeVisible();
      await expect(btn).toHaveAttribute("title", /.+/);
    }
  });

  test("a renderer crash is persisted as a stability report", async ({ page }) => {
    await openFixtureProject(page);

    await page.evaluate(() => {
      window.dispatchEvent(
        new ErrorEvent("error", {
          error: new Error("persisted crash"),
          message: "persisted crash",
        }),
      );
    });

    await expect(page.locator(".empty-state.card", { hasText: "Basebuild hit a problem" })).toBeVisible();

    // The ErrorBoundary invoked stability_record_renderer_crash exactly once,
    // routing source + details to the backend report store.
    const recorded = await page.evaluate(
      () =>
        (globalThis as typeof globalThis & { __BASEBUILD_RENDERER_CRASHES__?: Array<{ source?: string; message?: string }> })
          .__BASEBUILD_RENDERER_CRASHES__ ?? [],
    );
    expect(recorded.length).toBe(1);
    expect(recorded[0].source).toBe("Window error");
    expect(recorded[0].message).toContain("persisted crash");
  });
});
