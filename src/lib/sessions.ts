import { invoke } from "@tauri-apps/api/core";

export type TabKind = "terminal" | "empty" | "file" | "chat" | "omp";

export type Session = {
  id: string;
  projectPath: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type SessionTab = {
  id: string;
  sessionId: string;
  kind: TabKind;
  title: string;
  terminalId: number | null;
  filePath: string | null;
  chatSessionId: string | null;
  createdAt: number;
};

export async function createSession(projectPath: string, title: string): Promise<Session> {
  return invoke<Session>("create_session", { projectPath, title });
}

export async function listSessions(projectPath: string): Promise<Session[]> {
  return invoke<Session[]>("list_sessions", { projectPath });
}

export async function renameSession(id: string, title: string): Promise<void> {
  return invoke("rename_session", { id, title });
}

export async function deleteSession(id: string): Promise<void> {
  return invoke("delete_session", { id });
}

export async function createTab(
  sessionId: string,
  kind: TabKind,
  title: string,
  terminalId?: number,
  filePath?: string,
  chatSessionId?: string | null
): Promise<SessionTab> {
  return invoke<SessionTab>("create_tab", {
    sessionId,
    kind,
    title,
    terminalId: terminalId ?? null,
    filePath: filePath ?? null,
    chatSessionId: chatSessionId ?? null,
  });
}

export async function listTabs(sessionId: string): Promise<SessionTab[]> {
  return invoke<SessionTab[]>("list_tabs", { sessionId });
}

export async function deleteTab(id: string): Promise<void> {
  return invoke("delete_tab", { id });
}

export async function updateTabTerminal(id: string, terminalId: number | null): Promise<void> {
  return invoke("update_tab_terminal", { id, terminalId });
}

export async function updateTabFilePath(id: string, filePath: string | null): Promise<void> {
  return invoke("update_tab_file_path", { id, filePath });
}

export async function updateTabChatSession(id: string, chatSessionId: string | null): Promise<void> {
  return invoke("update_tab_chat_session", { id, chatSessionId });
}

export async function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", { path });
}
