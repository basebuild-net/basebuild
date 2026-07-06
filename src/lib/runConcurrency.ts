import { invoke } from "@tauri-apps/api/core";

/** Per-provider run-concurrency + subagent governance (`run-concurrency-limits`).
 *  Mirrors `src-tauri/src/models/run_concurrency.rs`. */

export type RunConcurrencyEntry = {
  /** Max simultaneous in-flight requests (runs + subagents) to this provider. Default 1. */
  maxConcurrency: number;
  /** Whether subagents are permitted at all. Default false. */
  subagentsEnabled: boolean;
  /** Max concurrent subagents when enabled. Counted against maxConcurrency. Default 0. */
  subagentMaxCount: number;
};

export type RunConcurrencyLimits = {
  /** Map of provider id → entry. Absent providers read as the conservative default. */
  providers: Record<string, RunConcurrencyEntry>;
};

export const DEFAULT_RUN_CONCURRENCY_ENTRY: RunConcurrencyEntry = {
  maxConcurrency: 1,
  subagentsEnabled: false,
  subagentMaxCount: 0,
};

/** Global per-provider run-concurrency defaults. */
export async function getRunConcurrencyDefaults(): Promise<RunConcurrencyLimits> {
  return invoke<RunConcurrencyLimits>("get_run_concurrency_defaults");
}

export async function setRunConcurrencyDefaults(limits: RunConcurrencyLimits): Promise<void> {
  return invoke("set_run_concurrency_defaults", { limits });
}

/** Per-project run-concurrency overrides. */
export async function getRunConcurrencyOverrides(projectPath: string): Promise<RunConcurrencyLimits> {
  return invoke<RunConcurrencyLimits>("get_run_concurrency_overrides", { projectPath });
}

export async function setRunConcurrencyOverride(
  projectPath: string,
  providerId: string,
  entry: RunConcurrencyEntry,
): Promise<void> {
  return invoke("set_run_concurrency_override", { projectPath, providerId, entry });
}

export async function removeRunConcurrencyOverride(
  projectPath: string,
  providerId: string,
): Promise<void> {
  return invoke("remove_run_concurrency_override", { projectPath, providerId });
}

/** Resolve the effective entry for a provider in a project: project override → global → conservative. */
export async function effectiveRunConcurrency(
  projectPath: string,
  providerId: string,
): Promise<RunConcurrencyEntry> {
  return invoke<RunConcurrencyEntry>("effective_run_concurrency", { projectPath, providerId });
}

/** Pure helper: resolve the effective entry from already-loaded limits. Used
 *  by the scheduler/UI without an extra round-trip. Mirrors the Rust
 *  `RunConcurrencyLimits::effective_for`. */
export function resolveEffective(
  providerId: string,
  projectLimits: RunConcurrencyLimits | null,
  globalLimits: RunConcurrencyLimits | null,
): RunConcurrencyEntry {
  const projectEntry = projectLimits?.providers?.[providerId];
  if (projectEntry) return projectEntry;
  const globalEntry = globalLimits?.providers?.[providerId];
  if (globalEntry) return globalEntry;
  return DEFAULT_RUN_CONCURRENCY_ENTRY;
}
