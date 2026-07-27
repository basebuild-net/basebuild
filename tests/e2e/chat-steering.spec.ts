import { expect, test, type Page } from "@playwright/test";
import { attachScreenshot, ensureChatPanel, openFixtureProject, selectLocalProvider } from "./helpers";

const STEER_SEND_TITLE = "Steer the running agent: your message is injected into the turn in progress";
const STOP_TITLE = "Stop the agent and unlock the composer";

/**
 * Select a configured, tools-capable route. Only those run the agent loop, so
 * only those can be steered. The mock ships Umans pre-connected with
 * "Umans GLM 5.2" (supportsTools: true); the local coordinator cannot be
 * steered because a plain streaming turn has no loop to join.
 */
async function selectSteerableProvider(page: Page) {
  await page.locator(".chat-column-model-chip").first().click();
  const overlay = page.locator(".provider-catalog-overlay");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await page.locator(".provider-card", { hasText: "Umans" }).first().click();
  const modelRow = page.locator(".provider-model-row", { hasText: "Umans GLM 5.2" }).first();
  await expect(modelRow).toBeVisible({ timeout: 5_000 });
  await modelRow.click();
}

async function sendMessage(page: Page, text: string) {
  const input = page.getByTitle(/Chat input/).first();
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(text);
  await page.getByTitle("Send message").click();
}

test.describe("chat steering: talk to the agent while it works", () => {
  test("a message sent mid-run is delivered into the running turn, not blocked", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectSteerableProvider(page);

    // stop-partial-test streams partial text then holds, giving a wide,
    // deterministic window in which the turn is genuinely still running.
    await sendMessage(page, "stop-partial-test");

    // The run is live: the stop control is offered.
    const stop = page.getByTitle(STOP_TITLE);
    await expect(stop).toBeVisible({ timeout: 10_000 });

    // The composer stays usable and re-labels itself as a steering surface
    // instead of locking the user out until the turn ends.
    const input = page.getByTitle(/Chat input/).first();
    await expect(input).toBeEnabled();
    await expect(input).toHaveAttribute("placeholder", /Steer the agent while it works/);
    const steerSend = page.getByTitle(STEER_SEND_TITLE);
    await expect(steerSend).toBeVisible();

    await input.fill("actually, focus on the null check first");
    await expect(steerSend).toBeEnabled();
    await steerSend.click();

    // The steer lands in the transcript as a user turn while the run is
    // still going, and the run is not cancelled by it.
    await expect(
      page.locator(".chat-message-user").filter({ hasText: "actually, focus on the null check first" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(stop).toBeVisible();
    await expect(input).toHaveValue("");

    await attachScreenshot(page, "chat-steering-mid-run.png");
  });

  test("a route with no agent loop is not advertised as steerable", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "stop-partial-test");
    await expect(page.getByTitle(STOP_TITLE)).toBeVisible({ timeout: 10_000 });

    // The local coordinator streams without an agent loop, so the composer
    // must not promise steering it cannot deliver.
    await expect(page.getByTitle(STEER_SEND_TITLE)).toHaveCount(0);
    await expect(page.getByTitle(/Chat input/).first()).toHaveAttribute("placeholder", /Type a message/);
  });

  test("with no run in flight the composer sends normally", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectSteerableProvider(page);

    const input = page.getByTitle(/Chat input/).first();
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await expect(input).toHaveAttribute("placeholder", /Type a message/);
    await expect(page.getByTitle("Send message")).toBeVisible();

    await sendMessage(page, "hello");
    await expect(page.locator(".chat-message-assistant .md-body").last()).toContainText("hello", {
      timeout: 15_000,
    });
  });
});
