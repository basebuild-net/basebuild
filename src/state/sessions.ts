import { useCallback, useEffect, useState } from "react";
import {
  createSession as createSessionApi,
  deleteSession as deleteSessionApi,
  listSessions,
  type Session,
  type SessionTab,
  type TabKind,
  createTab as createTabApi,
  deleteTab as deleteTabApi,
  listTabs,
  updateTabChatSession,
  renameSession as renameSessionApi,
} from "../lib/sessions";
import type { ChatGrid } from "../lib/gridMath";
import { setLastActiveSession as setLastActiveSessionApi } from "../lib/projects";
export function useSessionState(projectPath: string | null, lastActiveSessionId?: string | null) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [tabs, setTabs] = useState<SessionTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // Kept in-memory so the grid can mutate synchronously (resize/reorder) and
  // AppShell persists it back (debounced) via save_workspace_restore_state.
  const [tabGridStates, setTabGridStates] = useState<Record<string, ChatGrid>>({});

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const refreshSessions = useCallback(async () => {
    if (!projectPath) {
      setSessions([]);
      return;
    }
    try {
      const list = await listSessions(projectPath);
      setSessions(list);
      // Auto-select last active session if valid, else first session
      if (!list.find((s) => s.id === activeSessionId)) {
        const last = lastActiveSessionId && list.find((s) => s.id === lastActiveSessionId);
        setActiveSessionId(last ? last.id : list[0].id);
      }
    } catch {
      setSessions([]);
    }
  }, [projectPath, lastActiveSessionId]);

  const refreshTabs = useCallback(async () => {
    if (!activeSessionId) {
      setTabs([]);
      return;
    }
    try {
      const list = await listTabs(activeSessionId);
      setTabs(list);
      if (list.length > 0 && !list.find((t) => t.id === activeTabId)) {
        // Don't auto-select dead terminal tabs on restore - prefer non-terminal tabs
        const firstNonTerminal = list.find((t) => t.kind !== "terminal");
        setActiveTabId(firstNonTerminal?.id ?? null);
      } else if (list.length > 0) {
        // Even if the active tab still exists, if it's a terminal tab with no
        // live PTY (restored from a previous session), prefer a non-terminal tab.
        const active = list.find((t) => t.id === activeTabId);
        if (active?.kind === "terminal" && active.terminalId == null) {
          const firstNonTerminal = list.find((t) => t.kind !== "terminal");
          if (firstNonTerminal) setActiveTabId(firstNonTerminal.id);
        }
      }
    } catch (e) {
      console.error("Failed to list tabs:", e);
      setTabs([]);
    }
  }, [activeSessionId]);

  useEffect(() => {
    void refreshSessions();
    setActiveSessionId(null);
  }, [projectPath]);

  useEffect(() => {
    void refreshTabs();
  }, [activeSessionId]);

  const createSession = useCallback(
    async (title?: string) => {
      if (!projectPath) return null;
      const ts = new Date().toLocaleString();
      const session = await createSessionApi(projectPath, title ?? `Session ${ts}`);
      await refreshSessions();
      setActiveSessionId(session.id);
      return session;
    },
    [projectPath, refreshSessions],
  );

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setActiveTabId(null);
  }, []);

  const removeSession = useCallback(
    async (id: string) => {
      await deleteSessionApi(id);
      if (activeSessionId === id) {
        setActiveSessionId(null);
      }
      await refreshSessions();
    },
    [activeSessionId, refreshSessions],
  );

  const renameSession = useCallback(
    async (id: string, title: string) => {
      await renameSessionApi(id, title);
      await refreshSessions();
    },
    [refreshSessions],
  );

  const createTab = useCallback(
    async (kind: TabKind, title: string, terminalId?: number, filePath?: string, chatSessionId?: string | null) => {
      if (!activeSessionId) return null;
      const tab = await createTabApi(activeSessionId, kind, title, terminalId, filePath, chatSessionId);
      await refreshTabs();
      setActiveTabId(tab.id);
      return tab;
    },
    [activeSessionId, refreshTabs],
  );

  const removeTab = useCallback(
    async (id: string) => {
      await deleteTabApi(id);
      if (activeTabId === id) {
        setActiveTabId(null);
      }
      await refreshTabs();
    },
    [activeTabId, refreshTabs],
  );

  const setTabChatSession = useCallback(
    async (id: string, chatSessionId: string | null) => {
      await updateTabChatSession(id, chatSessionId);
      await refreshTabs();
    },
    [refreshTabs],
  );

  /** Update a chat tab's grid layout in-memory. Does not round-trip the
   *  backend — AppShell persists `tabGridStates` via workspace restore. */
  const setTabGrid = useCallback((id: string, grid: ChatGrid) => {
    setTabGridStates((prev) => ({ ...prev, [id]: grid }));
  }, []);

  /** Bulk-replace the grid states (used by AppShell to hydrate from restore). */
  const hydrateTabGridStates = useCallback((states: Record<string, ChatGrid>) => {
    setTabGridStates(states);
  }, []);

  return {
    sessions,
    activeSession,
    activeSessionId,
    tabs,
    activeTabId,
    activeTab: tabs.find((t) => t.id === activeTabId) ?? null,
    refreshSessions,
    refreshTabs,
    createSession,
    selectSession,
    removeSession,
    renameSession,
    createTab,
    removeTab,
    setTabChatSession,
    setActiveTabId,
    tabGridStates,
    setTabGrid,
    hydrateTabGridStates,
  };
}
