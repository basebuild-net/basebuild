import { invoke } from "@tauri-apps/api/core";

export type RequirementSeverity = "ok" | "attention" | "error";

export type RequirementStatus = {
  id: string;
  label: string;
  required: boolean;
  installed: boolean;
  version: string | null;
  severity: RequirementSeverity;
  message: string | null;
};

export const gitInstallCommand = "winget install --id Git.Git -e --source winget";
export const gitDownloadUrl = "https://git-scm.com/download/win";

export async function listRequirements(): Promise<RequirementStatus[]> {
  return invoke<RequirementStatus[]>("list_requirements");
}
