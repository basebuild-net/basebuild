import { invoke } from "@tauri-apps/api/core";

export type SkillSource = "bundled" | "user" | "override";
export type SkillRuntime = "native" | "omp" | "both";

export type ResolvedSkill = {
  name: string;
  description: string;
  source: SkillSource;
  runtime: SkillRuntime;
  path: string;
};

export async function listResolvedSkills(): Promise<ResolvedSkill[]> {
  return invoke<ResolvedSkill[]>("list_resolved_skills");
}

export async function readResolvedSkill(skillName: string): Promise<string> {
  return invoke<string>("read_resolved_skill", { skillName });
}

export async function provisionSkillDirs(): Promise<string[]> {
  return invoke<string[]>("provision_skill_dirs");
}
