import { invoke } from "@tauri-apps/api/core";

export interface SkillMeta {
  name: string;
  description: string;
  content: string;
}

export async function readSkill(skillName: string): Promise<SkillMeta> {
  return invoke<SkillMeta>("read_skill", { skillName });
}

export async function generateSessionTitle(context: {
  projectPath: string;
  projectName: string;
  recentOutput: string;
  existingTitle: string;
  tabKinds: string[];
}): Promise<string | null> {
  try {
    const skill = await readSkill("basebuild-session-title");
    const prompt = `Project: ${context.projectName}
Path: ${context.projectPath}
Existing title: ${context.existingTitle}
Tab kinds: ${context.tabKinds.join(", ")}
Recent work output:\n${context.recentOutput.trim().slice(-2000)}`;

    const result = await invoke<string>("omp_stream_command", {
      args: [
        "-p",
        "--smol",
        "--no-tools",
        "--system-prompt",
        skill.content,
        prompt,
      ],
      cwd: null,
      projectPath: context.projectPath,
    });

    const title = result.trim().split("\n")[0].replace(/^["'`]+|["'`]+$/g, "").trim();
    if (!title || title.length > 80) return null;
    return title;
  } catch {
    return null;
  }
}
