import { invoke } from "@tauri-apps/api/core";
import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";

export type TerminalSession = {
  id: number;
  shell: string;
  cwd: string | null;
};

export type TerminalCloseEvent = {
  id: number;
  kind: "close";
};

export type TerminalDataEvent = {
  id: number;
  kind: "data";
  data: string;
};

export type TerminalEvent = TerminalCloseEvent | TerminalDataEvent;

export async function createTerminal(shell: string, cwd?: string): Promise<TerminalSession> {
  return invoke<TerminalSession>("create_terminal", { shell, cwd });
}

export async function writeTerminal(id: number, data: string): Promise<void> {
  return invoke("write_terminal", { id, data });
}

export async function resizeTerminal(id: number, rows: number, cols: number): Promise<void> {
  return invoke("resize_terminal", { id, rows, cols });
}

export async function closeTerminal(id: number): Promise<void> {
  return invoke("close_terminal", { id });
}

export async function listenTerminalOutput(handler: EventCallback<TerminalEvent>): Promise<UnlistenFn> {
  return listen<TerminalEvent>("terminal://output", handler);
}
