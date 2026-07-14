import { expect, test, type Page } from "@playwright/test";
import {
  MVP_FIXTURE_CATEGORIES,
  MVP_FIXTURE_PROJECTS,
  type MvpFixtureCategory,
  type MvpFixtureProject,
} from "../../src/test-support/fixture-data";

export type OpenMvpFixtureOptions = {
  /** Force the mocked folder picker to return this path instead of the fixture default. */
  projectPath?: string;
  /** Artificial delay for the mocked folder picker (ms). Used to test single-flight behavior. */
  pickerDelayMs?: number;
  /** Artificial delay for the mocked workspace restore (ms). Used to test generation-guard behavior. */
  restoreDelayMs?: number;
};

/**
 * Seed the deterministic MVP fixture and navigate to the app.
 *
 * Contract: sets `window.__BASEBUILD_E2E_FIXTURE__ = "mvp-baseline"` and optional
 * picker globals before the Tauri mock initializes, then loads `/`. The backend mock
 * will expose fixture projects, sessions, tabs, categories, ideas, plans, restore
 * state, and an authenticated account profile.
 */
export async function openMvpFixtureProject(
  page: Page,
  options: OpenMvpFixtureOptions = {},
): Promise<void> {
  await page.addInitScript((opts: OpenMvpFixtureOptions) => {
    localStorage.setItem("basebuild:first-run-complete", "true");
    const w = window as typeof window & {
      __BASEBUILD_E2E_FIXTURE__?: string;
      __BASEBUILD_E2E_PICK_PROJECT_PATH__?: string;
      __BASEBUILD_E2E_PICKER_DELAY_MS__?: number;
      __BASEBUILD_E2E_RESTORE_DELAY_MS__?: number;
    };
    w.__BASEBUILD_E2E_FIXTURE__ = "mvp-baseline";
    if (opts.projectPath) {
      w.__BASEBUILD_E2E_PICK_PROJECT_PATH__ = opts.projectPath;
    }
    if (opts.pickerDelayMs !== undefined) {
      w.__BASEBUILD_E2E_PICKER_DELAY_MS__ = opts.pickerDelayMs;
    }
    if (opts.restoreDelayMs !== undefined) {
      w.__BASEBUILD_E2E_RESTORE_DELAY_MS__ = opts.restoreDelayMs;
    }
  }, options);
  await page.goto("/");
}

/** Wait for the app shell to exist in the DOM. */
export async function waitForAppReady(page: Page): Promise<void> {
  await page.locator(".app-shell").waitFor({ state: "attached", timeout: 10_000 });
}

/**
 * Open the MVP fixture project and wait for the app shell to be ready.
 * Convenience wrapper combining `openMvpFixtureProject` + `waitForAppReady`.
 */
export async function openFixtureProject(page: Page): Promise<void> {
  await openMvpFixtureProject(page);
  await waitForAppReady(page);
}

/**
 * Ensure a chat panel exists and its input is ready. Wait for the fixture to
 * restore a panel (up to 3s). If none appears, click "New chat" and wait for
 * the chat input to become visible. All locator-based — no fixed sleeps.
 */
export async function ensureChatPanel(page: Page): Promise<void> {
  const panel = page.locator(".panel-grid-leaf").first();
  try {
    // Wait for the fixture to restore a panel.
    await panel.waitFor({ state: "attached", timeout: 3_000 });
  } catch {
    // No panel restored — create a new chat tab.
    await page.getByTitle("New chat").first().click();
  }
  // Wait for the chat input to be visible in the (now-existing) panel.
  await page
    .getByTitle(/Chat input/)
    .first()
    .waitFor({ state: "visible", timeout: 5_000 });
}

export function fixtureProject(index: number): MvpFixtureProject {
  return MVP_FIXTURE_PROJECTS[index];
}

export function fixtureCategory(index: number): MvpFixtureCategory {
  return MVP_FIXTURE_CATEGORIES[index];
}

/** Start collecting console/pageerror logs for this page. */
export function collectLogs(page: Page): string[] {
  const logs: string[] = [];
  page.on("console", (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    logs.push(`[pageerror] ${err.message}`);
  });
  return logs;
}

/** Attach collected logs to the current Playwright test result. */
export async function attachLogs(logs: string[], name = "logs.txt"): Promise<void> {
  await test.info().attach(name, {
    body: logs.join("\n"),
    contentType: "text/plain",
  });
}

/** Attach a full-page screenshot to the current Playwright test result. */
export async function attachScreenshot(page: Page, name: string): Promise<void> {
  await test.info().attach(name, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
}

/** Attach a timing measurement to the current Playwright test result. */
export async function attachTiming(name: string, ms: number): Promise<void> {
  await test.info().attach(`${name}-timing.txt`, {
    body: `${ms.toFixed(2)} ms`,
    contentType: "text/plain",
  });
}

/** Read a counter from the mocked Tauri state exposed on `window`. */
export async function readE2eStateCounter(
  page: Page,
  key: "pickProjectCalls",
): Promise<number> {
  return page.evaluate((k) => {
    const w = window as typeof window & {
      __BASEBUILD_E2E_STATE__?: Record<string, unknown>;
    };
    const value = w.__BASEBUILD_E2E_STATE__?.[k];
    return typeof value === "number" ? value : 0;
  }, key);
}

/**
 * Open the planning inspector modal via the PlanningIndicators dropdown.
 *
 * Contract: clicks the `plans` stage indicator, waits for the dropdown,
 * clicks the "Full UI" button, and waits for the planning inspector modal
 * to be visible. Replaces the old "Plans & Ideas" button click flow.
 */
export async function openPlanningModal(page: Page): Promise<void> {
  const indicator = page.locator('.planning-indicator[data-stage="plans"]').first();
  await indicator.waitFor({ state: "visible", timeout: 10_000 });
  await indicator.click();
  const dropdown = page.locator('.planning-notification-dropdown').first();
  await dropdown.waitFor({ state: "visible", timeout: 5_000 });
  await dropdown.getByRole("button", { name: /full UI/i }).click();
  await page.locator('.planning-inspector-modal, .modal-overlay[aria-label="Plans & Ideas"]').first().waitFor({ state: "visible", timeout: 5_000 });
}

/**
 * Select the local (basebuild-local) provider and its first model in the
 * provider/model catalog. The mock labels the local provider as "None" with
 * model "basebuild-local-coordinator" (also labeled "None").
 *
 * Contract: opens the catalog via the model chip, clicks the "None" provider
 * card, then clicks the first model row — which both selects the model and
 * closes the catalog. Replaces the old flow of clicking `.provider-card` first()
 * followed by the close button, which did not actually select a model.
 */
export async function selectLocalProvider(page: Page): Promise<void> {
  await page.locator(".chat-column-model-chip").first().click();
  const overlay = page.locator(".provider-catalog-overlay");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  // The local provider card has label "None" in the e2e mock.
  const localCard = page.locator(".provider-card", { hasText: "None" }).first();
  await expect(localCard).toBeVisible({ timeout: 10_000 });
  await localCard.click();
  // Click the first model row to select the model (also closes the catalog).
  const modelRow = page.locator(".provider-model-row").first();
  await expect(modelRow).toBeVisible({ timeout: 5_000 });
  await modelRow.click();
}
