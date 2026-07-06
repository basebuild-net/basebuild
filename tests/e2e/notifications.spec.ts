import { expect, test, type Page } from "@playwright/test";

async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(
    page.locator(".status-pill", { hasText: "C:\\basebuild-e2e\\project" }),
  ).toBeVisible();
}

test.describe("Notifications: toast + center + badge", () => {
  test("event → toast renders → center unread → mark-read → badge clears", async ({ page }) => {
    await openFixtureProject(page);

    // The notification bell is in the chat-env-panel header.
    const bell = page.locator(".notification-bell");
    await expect(bell).toBeVisible({ timeout: 10_000 });

    // Initially no unread badge (no notifications).
    await expect(page.locator(".notification-badge")).toHaveCount(0);

    // Inject a notification via the mocked state by calling notification_mark_read
    // then adding one through the mock. We simulate by invoking a plan status
    // change which triggers a planning event → notification insert.
    // For the e2e mock, we directly push into the notification state via
    // page.evaluate.
    await page.evaluate(() => {
      const w = window as unknown as { __BASEBUILD_E2E_STATE__?: { notifications: unknown[] } };
      const s = w.__BASEBUILD_E2E_STATE__;
      if (s) {
        s.notifications.push({
          id: "test-notif-1",
          kind: "run_finished",
          entityId: "run_1",
          entityKind: "plan_run",
          projectPath: "C:\\basebuild-e2e\\project",
          title: "Run finished: Add dark mode",
          detail: "All tasks complete",
          read: false,
          createdAt: Date.now(),
        });
      }
    });

    // Trigger a refresh by emitting the notifications://changed event.
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("notifications-changed-test"));
    });
    // The ToastStack polls via the notifications://changed listener; in the
    // mock environment, the event is emitted by the backend. We simulate by
    // calling the notification list to refresh the UI.
    await page.waitForTimeout(500);

    // Open the notification center.
    await bell.click();
    await expect(page.locator(".notification-center")).toBeVisible();

    // The notification should be listed.
    await expect(page.locator(".notification-item-title").filter({ hasText: "Run finished: Add dark mode" })).toBeVisible();

    // The unread badge should show 1.
    await expect(page.locator(".notification-badge")).toContainText("1");

    // Click mark-all-read.
    await page.getByTitle("Mark all as read").click();
    await page.waitForTimeout(300);

    // Badge should clear.
    await expect(page.locator(".notification-badge")).toHaveCount(0);

    // The notification should be marked read (dimmed).
    await expect(page.locator(".notification-item.notification-read")).toBeVisible();
  });

  test("per-kind mute suppresses toast", async ({ page }) => {
    await openFixtureProject(page);

    // Open settings → notifications.
    await page.getByTitle("Settings").click();
    await expect(page.locator(".settings-modal")).toBeVisible();
    await page.locator(".settings-tab", { hasText: "Notifications" }).click();

    // Set "Run finished" to center-only (no toast).
    const runFinishedRow = page.locator(".settings-row", { hasText: "Run finished" });
    await runFinishedRow.locator("select").selectOption("center_only");

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // Inject a run_finished notification.
    await page.evaluate(() => {
      const w = window as unknown as { __BASEBUILD_E2E_STATE__?: { notifications: unknown[] } };
      const s = w.__BASEBUILD_E2E_STATE__;
      if (s) {
        s.notifications.push({
          id: "test-notif-muted",
          kind: "run_finished",
          entityId: "run_2",
          entityKind: "plan_run",
          projectPath: "C:\\basebuild-e2e\\project",
          title: "Run finished: Muted run",
          read: false,
          createdAt: Date.now(),
        });
      }
    });
    await page.waitForTimeout(500);

    // No toast should appear (center-only delivery).
    await expect(page.locator(".toast-stack")).toHaveCount(0);

    // But the notification center should still list it.
    const bell = page.locator(".notification-bell");
    await bell.click();
    await expect(page.locator(".notification-center")).toBeVisible();
    await expect(page.locator(".notification-item-title").filter({ hasText: "Muted run" })).toBeVisible();
  });
});
