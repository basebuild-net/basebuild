import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
} from "lucide-react";

import type { RecentProject } from "../../lib/projects";
import type { Session } from "../../lib/sessions";
import { AccountButton } from "./AccountButton";
import { UpdateButton } from "./UpdateButton";
import type { AccountState } from "../../state/account";
import type { UpdaterState } from "../../state/updater";

type ProjectChatSidebarProps = {
  activeProjectPath: string | null;
  activeSessionId: string | null;
  projects: RecentProject[];
  sessionsByProject: Map<string, Session[]>;
  account: AccountState;
  updates: UpdaterState;
  onSelectProject: (path: string) => void;
  onOpenFolder: () => void;
  onRemoveProject: (path: string) => void;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession?: (id: string) => void;
  onOpenSettings: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

const PINNED_KEY = "basebuild.pinnedChats";

function loadPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    // ignore corrupt storage
  }
  return new Set();
}

function savePinned(set: Set<string>): void {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify([...set]));
  } catch {
    // ignore quota / disabled storage
  }
}

/**
 * Compact relative timestamp per chat-first-shell spec:
 * 5s, 1min, 2h, 3d, 1mo. `ts` is epoch seconds.
 */
function relativeTime(ts: number): string {
  const now = Date.now();
  const diffMs = now - ts * 1000;
  if (diffMs < 60_000) return `${Math.max(1, Math.floor(diffMs / 1000))}s`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}min`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h`;
  if (diffMs < 2_592_000_000) return `${Math.floor(diffMs / 86_400_000)}d`;
  return `${Math.floor(diffMs / 2_592_000_000)}mo`;
}

const RECENT_PER_PROJECT = 5;

type ChatRow = {
  project: RecentProject;
  session: Session;
  pinned: boolean;
};

export function ProjectChatSidebar({
  activeProjectPath,
  activeSessionId,
  projects,
  sessionsByProject,
  account,
  updates,
  onSelectProject,
  onOpenFolder,
  onRemoveProject,
  onSelectSession,
  onCreateSession,
  onRenameSession,
  onDeleteSession,
  onOpenSettings,
  collapsed,
  onToggleCollapse,
}: ProjectChatSidebarProps) {
  const [pinned, setPinned] = useState<Set<string>>(() => loadPinned());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    savePinned(pinned);
  }, [pinned]);

  const togglePin = (id: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleProjectExpanded = (path: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Flatten + sort all chats by updatedAt desc, partition pinned/unpinned.
  const { pinnedRows, byProject } = useMemo(() => {
    const pinnedRows: ChatRow[] = [];
    const byProject: { project: RecentProject; recent: ChatRow[]; overflow: ChatRow[] }[] = [];
    for (const project of projects) {
      const sessions = (sessionsByProject.get(project.path) ?? []).slice().sort((a, b) => b.updatedAt - a.updatedAt);
      const rows: ChatRow[] = sessions.map((session) => ({
        project,
        session,
        pinned: pinned.has(session.id),
      }));
      const pinnedForProject = rows.filter((r) => r.pinned);
      const unpinnedForProject = rows.filter((r) => !r.pinned);
      pinnedRows.push(...pinnedForProject);
      const recent = unpinnedForProject.slice(0, RECENT_PER_PROJECT);
      const overflow = unpinnedForProject.slice(RECENT_PER_PROJECT);
      byProject.push({ project, recent, overflow });
    }
    pinnedRows.sort((a, b) => b.session.updatedAt - a.session.updatedAt);
    return { pinnedRows, byProject };
  }, [projects, sessionsByProject, pinned]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    const out: ChatRow[] = [];
    for (const project of projects) {
      const sessions = sessionsByProject.get(project.path) ?? [];
      for (const session of sessions) {
        if (session.title.toLowerCase().includes(q) || project.path.toLowerCase().includes(q)) {
          out.push({ project, session, pinned: pinned.has(session.id) });
        }
      }
    }
    out.sort((a, b) => b.session.updatedAt - a.session.updatedAt);
    return out;
  }, [projects, sessionsByProject, pinned, searchQuery]);

  if (collapsed) {
    return (
      <aside className="project-chat-sidebar is-collapsed" aria-label="Projects and chats (collapsed)">
        <div className="sidebar-top-actions">
          <button className="btn-icon" type="button" title="New chat" onClick={onCreateSession} disabled={!activeProjectPath}>
            <Plus size={14} />
          </button>
          <button className="btn-icon" type="button" title="Search chats" onClick={() => { setCollapsedFalse(onToggleCollapse); setSearchOpen(true); }}>
            <Search size={14} />
          </button>
          <button className="btn-icon" type="button" title="Add project folder" onClick={onOpenFolder}>
            <FolderPlus size={14} />
          </button>
          <button className="btn-icon" type="button" title="Expand sidebar" onClick={onToggleCollapse}>
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="sidebar-collapsed-spacer" />
        <div className="sidebar-bottom-account">
          <button className="btn-icon" type="button" title="Settings" onClick={onOpenSettings}>
            <Settings2 size={14} />
          </button>
          {updates.info?.available ? (
            <button
              className="update-taskbar-btn"
              type="button"
              title={`Download and install Basebuild ${updates.info.version ?? ""}`}
              onClick={() => void updates.install()}
              disabled={updates.status === "installing"}
            >
              <span>{updates.status === "installing" ? "…" : "↑"}</span>
            </button>
          ) : null}
        </div>
      </aside>
    );
  }

  return (
    <aside className="project-chat-sidebar" aria-label="Projects and chats">
      <div className="sidebar-top-actions">
        <button className="btn btn-ghost btn-sm" type="button" title="New chat" onClick={onCreateSession} disabled={!activeProjectPath}>
          <Plus size={12} /> New chat
        </button>
        <button
          className="btn-icon"
          type="button"
          title={searchOpen ? "Close search" : "Search chats"}
          onClick={() => setSearchOpen((v) => !v)}
        >
          {searchOpen ? <ChevronDown size={14} /> : <Search size={14} />}
        </button>
        <button className="btn-icon" type="button" title="Add project folder" onClick={onOpenFolder}>
          <FolderPlus size={14} />
        </button>
        <button className="btn-icon" type="button" title="Collapse sidebar" onClick={onToggleCollapse}>
          <ChevronLeft size={14} />
        </button>
      </div>
      {searchOpen ? (
        <div className="sidebar-search">
          <input
            className="input sidebar-search-input"
            type="text"
            placeholder="Search chats and projects…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            title="Search chats and projects"
            autoFocus
          />
        </div>
      ) : null}

      <div className="sidebar-chat-list">
        {filtered ? (
          filtered.length === 0 ? (
            <div className="sidebar-empty text-muted text-sm">No chats match “{searchQuery}”.</div>
          ) : (
            <ul className="chat-list">
              {filtered.map(({ project, session, pinned: isPinned }) => (
                <li
                  key={session.id}
                  className={`chat-row${session.id === activeSessionId ? " is-active" : ""}`}
                  title={`${session.title} — ${project.path}`}
                  onClick={() => { onSelectProject(project.path); onSelectSession(session.id); }}
                >
                  <span className="chat-row-title">{session.title}</span>
                  <span className="chat-row-meta">
                    <span className="chat-row-time mono">{relativeTime(session.updatedAt)}</span>
                    <button
                      className="chat-row-pin"
                      type="button"
                      title={isPinned ? "Unpin chat" : "Pin chat"}
                      onClick={(e) => { e.stopPropagation(); togglePin(session.id); }}
                    >
                      {isPinned ? <Pin size={10} /> : <PinOff size={10} />}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            {pinnedRows.length > 0 ? (
              <div className="chat-group chat-group-pinned">
                <div className="chat-group-label">Pinned</div>
                <ul className="chat-list">
                  {pinnedRows.map(({ project, session, pinned: isPinned }) => (
                    <li
                      key={session.id}
                      className={`chat-row${session.id === activeSessionId ? " is-active" : ""}`}
                      title={`${session.title} — ${project.path}`}
                      onClick={() => { onSelectProject(project.path); onSelectSession(session.id); }}
                    >
                      <span className="chat-row-title">{session.title}</span>
                      <span className="chat-row-meta">
                        <span className="chat-row-time mono">{relativeTime(session.updatedAt)}</span>
                        <button
                          className="chat-row-pin"
                          type="button"
                          title="Unpin chat"
                          onClick={(e) => { e.stopPropagation(); togglePin(session.id); }}
                        >
                          <Pin size={10} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {byProject.map(({ project, recent, overflow }) => {
              const isActiveProject = project.path === activeProjectPath;
              const isExpanded = expandedProjects.has(project.path);
              const name = project.path.split(/[\\/]/).pop() ?? project.path;
              return (
                <div key={project.path} className={`chat-group${isActiveProject ? " is-active-project" : ""}`}>
                  <div
                    className="chat-group-header"
                    title={project.path}
                    onClick={() => onSelectProject(project.path)}
                  >
                    <ChevronDown size={12} className={`chat-group-chevron${isActiveProject && !isExpanded ? " is-collapsed" : ""}`} />
                    <span className="chat-group-name">{name}</span>
                    <button
                      className="chat-group-more"
                      type="button"
                      title="Remove project from list"
                      onClick={(e) => { e.stopPropagation(); onRemoveProject(project.path); }}
                    >
                      ×
                    </button>
                  </div>
                  {(isActiveProject || isExpanded) && recent.length === 0 ? (
                    <div className="chat-group-empty text-muted text-sm">
                      No chats yet. <button className="chat-link-btn" type="button" onClick={onCreateSession}>Start one</button>.
                    </div>
                  ) : null}
                  {recent.length > 0 ? (
                    <ul className="chat-list">
                      {recent.map(({ session, pinned: isPinned }) => (
                        <li
                          key={session.id}
                          className={`chat-row${session.id === activeSessionId ? " is-active" : ""}`}
                          title={`${session.title} — ${project.path}`}
                          onClick={() => onSelectSession(session.id)}
                          onDoubleClick={() => { setRenamingId(session.id); setRenameValue(session.title); }}
                        >
                          {renamingId === session.id ? (
                            <input
                              className="input chat-row-rename"
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => { if (renameValue.trim()) onRenameSession(session.id, renameValue.trim()); setRenamingId(null); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { if (renameValue.trim()) onRenameSession(session.id, renameValue.trim()); setRenamingId(null); }
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              title="Rename chat (Enter to save, Esc to cancel)"
                              autoFocus
                            />
                          ) : (
                            <span className="chat-row-title">{session.title}</span>
                          )}
                          <span className="chat-row-meta">
                            <span className="chat-row-time mono">{relativeTime(session.updatedAt)}</span>
                            <button
                              className="chat-row-pin"
                              type="button"
                              title={isPinned ? "Unpin chat" : "Pin chat"}
                              onClick={(e) => { e.stopPropagation(); togglePin(session.id); }}
                            >
                              {isPinned ? <Pin size={10} /> : <PinOff size={10} />}
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {overflow.length > 0 ? (
                    <button
                      className="chat-show-more"
                      type="button"
                      title={isExpanded ? "Show fewer chats" : `Show ${overflow.length} more chats`}
                      onClick={() => toggleProjectExpanded(project.path)}
                    >
                      <ChevronDown size={10} className={isExpanded ? "is-flipped" : ""} />
                      {isExpanded ? "Show less" : `Show ${overflow.length} more`}
                    </button>
                  ) : null}
                  {isExpanded && overflow.length > 0 ? (
                    <ul className="chat-list chat-list-overflow">
                      {overflow.map(({ session, pinned: isPinned }) => (
                        <li
                          key={session.id}
                          className={`chat-row${session.id === activeSessionId ? " is-active" : ""}`}
                          title={`${session.title} — ${project.path}`}
                          onClick={() => onSelectSession(session.id)}
                          onDoubleClick={() => { setRenamingId(session.id); setRenameValue(session.title); }}
                        >
                          {renamingId === session.id ? (
                            <input
                              className="input chat-row-rename"
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => { if (renameValue.trim()) onRenameSession(session.id, renameValue.trim()); setRenamingId(null); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { if (renameValue.trim()) onRenameSession(session.id, renameValue.trim()); setRenamingId(null); }
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              title="Rename chat (Enter to save, Esc to cancel)"
                              autoFocus
                            />
                          ) : (
                            <span className="chat-row-title">{session.title}</span>
                          )}
                          <span className="chat-row-meta">
                            <span className="chat-row-time mono">{relativeTime(session.updatedAt)}</span>
                            <button
                              className="chat-row-pin"
                              type="button"
                              title={isPinned ? "Unpin chat" : "Pin chat"}
                              onClick={(e) => { e.stopPropagation(); togglePin(session.id); }}
                            >
                              {isPinned ? <Pin size={10} /> : <PinOff size={10} />}
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="sidebar-bottom-account">
        <AccountButton account={account} onOpenSettings={onOpenSettings} />
        <UpdateButton updates={updates} onOpenSettings={onOpenSettings} />
      </div>
    </aside>
  );
}

// Helper: when collapsed and the user hits search, expand first.
function setCollapsedFalse(onToggleCollapse: () => void) {
  onToggleCollapse();
}
