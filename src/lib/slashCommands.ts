import { invoke } from "@tauri-apps/api/core";

export type SlashCommand = {
  name: string;
  description: string;
  source: string;
  priority: number;
  shadowed: boolean;
  filePath: string | null;
  body: string | null;
};

export type ExpandedCommand = {
  prompt: string | null;
  builtinAction: string | null;
  arguments: string[];
};

export async function listSlashCommands(projectPath: string): Promise<SlashCommand[]> {
  return invoke<SlashCommand[]>("list_slash_commands", { projectPath });
}

export async function expandSlashCommand(body: string, args: string): Promise<ExpandedCommand> {
  return invoke<ExpandedCommand>("expand_slash_command", { body, args });
}
