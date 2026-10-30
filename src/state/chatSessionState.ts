import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  nativeChatContextFiles,
  nativeChatTodos,
  type NativeContextFile,
  type NativeTodoItem,
} from "../lib/native-chat";

/**
 * The agent's checklist for a native chat session. Loaded when the session
 * binds, then kept current from `native-chat://todos`, which the backend emits
 * after every `todo_write` call. The checklist is optional chrome, so a failed
 * load leaves it empty rather than blocking the transcript.
 */
export function useSessionTodos(sessionId: string | null): NativeTodoItem[] {
  const [todos, setTodos] = useState<NativeTodoItem[]>([]);

  useEffect(() => {
    setTodos([]);
    if (!sessionId) return;
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    void nativeChatTodos(sessionId)
      .then((items) => {
        if (!cancelled) setTodos(items);
      })
      .catch(() => {});
    listen<{ sessionId: string; todos: NativeTodoItem[] }>("native-chat://todos", (event) => {
      if (event.payload.sessionId === sessionId) setTodos(event.payload.todos);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [sessionId]);

  return todos;
}

/**
 * Context files (AGENTS.md, CLAUDE.md) the next request for this project will
 * include. Re-read whenever `refreshKey` changes, so an edit made between turns
 * shows up after the next turn; the chip is informational, so a failed read
 * shows no files instead of an error.
 */
export function useContextFiles(projectPath: string | null, refreshKey: number): NativeContextFile[] {
  const [files, setFiles] = useState<NativeContextFile[]>([]);

  useEffect(() => {
    setFiles([]);
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    void nativeChatContextFiles(projectPath)
      .then((list) => {
        if (!cancelled) setFiles(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectPath, refreshKey]);

  return files;
}
