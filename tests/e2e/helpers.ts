import { test, type Page } from "@playwright/test";
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
    };
    w.__BASEBUILD_E2E_FIXTURE__ = "mvp-baseline";
    if (opts.projectPath) {
      w.__BASEBUILD_E2E_PICK_PROJECT_PATH__ = opts.projectPath;
    }
    if (opts.pickerDelayMs !== undefined) {
      w.__BASEBUILD_E2E_PICKER_DELAY_MS__ = opts.pickerDelayMs;
    }
  }, options);
  await page.goto("/");
}

/** Wait for the app shell to exist in the DOM. */
export async function waitForAppReady(page: Page): Promise<void> {
  await page.locator(".app-shell").waitFor({ state: "attached", timeout: 10_000 });
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
