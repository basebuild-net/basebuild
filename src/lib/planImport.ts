import { invoke } from "@tauri-apps/api/core";

import type { PlanStatus } from "./plans";

export type PlanImportCandidate = {
  slug: string;
  title: string;
  external: string;
  engine: string;
  derivedStatus: PlanStatus;
  completed: number;
  total: number;
  warning?: string;
};

export type PlanImportResult = {
  slug: string;
  planPath: string;
  status: PlanStatus;
  skipped: boolean;
  warning?: string;
};

/** Detect importable external plans (unlinked openspec/changes/ folders). */
export async function planImportDetect(projectPath: string): Promise<PlanImportCandidate[]> {
  return invoke<PlanImportCandidate[]>("plan_import_detect", { projectPath });
}

/** Import confirmed candidates by writing .basebuild/plans/<slug>/plan.md records. */
export async function planImportApply(
  projectPath: string,
  slugs: string[],
): Promise<PlanImportResult[]> {
  return invoke<PlanImportResult[]>("plan_import_apply", { projectPath, slugs });
}
