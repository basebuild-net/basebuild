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
  renameSession as renameSessionApi,
} from "../lib/sessions";

export function useSessionState(projectPath: string | null) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [tabs, setTabs] = useState<SessionTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const refreshSessions = useCallback(async () => {
    if (!projectPath) {
      setSessions([]);
      return;
    }
    try {
      const list = await listSessions(projectPath);
      setSessions(list);
      // Auto-select first session if none selected
      if (list.length > 0 && !list.find((s) => s.id === activeSessionId)) {
        setActiveSessionId(list[0].id);
      }
    } catch {
      setSessions([]);
    }
  }, [projectPath]);

  const refreshTabs = useCallback(async () => {
    if (!activeSessionId) {
      setTabs([]);
      return;
    }
    try {
      const list = await listTabs(activeSessionId);
      setTabs(list);
      if (list.length > 0 && !list.find((t) => t.id === activeTabId)) {
        setActiveTabId(list[0].id);
      }
    } catch {
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
    async (kind: TabKind, title: string, terminalId?: number) => {
      if (!activeSessionId) return null;
      const tab = await createTabApi(activeSessionId, kind, title, terminalId);
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
    setActiveTabId,
  };
}
