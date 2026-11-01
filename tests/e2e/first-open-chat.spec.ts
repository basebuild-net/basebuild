import { expect, test, type Page } from "@playwright/test";
import { waitForAppReady } from "./helpers";

type MockTab = { id: string; sessionId: string; kind: string; chatSessionId: string | null };

async function mockSessionsAndTabs(page: Page): Promise<{ sessions: number; tabs: MockTab[] }> {
  return page.evaluate(() => {
    const state = (window as typeof window & {
      __BASEBUILD_E2E_STATE__: { sessions: unknown[]; tabs: MockTab[] };
    }).__BASEBUILD_E2E_STATE__;
    return {
      sessions: state.sessions.length,
      tabs: state.tabs.map(({ id, sessionId, kind, chatSessionId }) => ({ id, sessionId, kind, chatSessionId })),
    };
  });
}

async function openFreshProject(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await waitForAppReady(page);
  await page.locator(".get-started").getByRole("button", { name: "Open project" }).click();
  await expect(page.getByTitle(/Chat input/).first()).toBeVisible({ timeout: 10_000 });
}

test.describe("First chat in a newly opened project", () => {
  test("creates one session and one chat tab bound to the chat, with no orphan warning", async ({ page }) => {
    await openFreshProject(page);

    // The backing tab is bound once the panel's chat session exists.
    await expect.poll(async () => (await mockSessionsAndTabs(page)).tabs[0]?.chatSessionId ?? null, { timeout: 5_000 })
      .not.toBeNull();
    const { sessions, tabs } = await mockSessionsAndTabs(page);
    expect(sessions).toBe(1);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].kind).toBe("chat");
    await expect(page.getByText("Orphaned session tabs recovered")).toHaveCount(0);

    // A second chat gets its own bound tab.
    const newChat = page.locator(".sidebar-top-actions").getByRole("button", { name: "New chat", exact: true });
    await expect(newChat).toBeEnabled();
    await newChat.click();
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);
    await expect.poll(async () => {
      const current = (await mockSessionsAndTabs(page)).tabs;
      return current.length === 2 && current.every((tab) => tab.chatSessionId !== null);
    }, { timeout: 5_000 }).toBe(true);
    const bound = (await mockSessionsAndTabs(page)).tabs.map((tab) => tab.chatSessionId);
    expect(new Set(bound).size).toBe(2);
    await expect(page.getByText("Orphaned session tabs recovered")).toHaveCount(0);
  });

  test("an empty chat offers starters that run their commands", async ({ page }) => {
    await openFreshProject(page);
    const starter = page.locator(".chat-starter").first();
    await expect(starter).toBeVisible();
    await expect(starter.locator(".chat-starter-title")).toHaveText([
      "Describe this project",
      "Generate ideas",
      "Plan before editing",
    ]);

    // Plan mode is a local command: the starter turns it on and drops out.
    await starter.getByRole("button", { name: /Plan before editing/ }).click();
    await expect(page.getByText("Plan mode on").first()).toBeVisible();
    await expect(starter.locator(".chat-starter-title")).toHaveText(["Describe this project", "Generate ideas"]);

    // The schematic starter sends the wizard skill as the first turn; the
    // transcript is no longer empty, so the starter is gone.
    await starter.getByRole("button", { name: /Describe this project/ }).click();
    await expect(page.locator(".chat-message-user").first()).toContainText("/schematic");
    await expect(page.locator(".chat-starter")).toHaveCount(0);
  });
});
