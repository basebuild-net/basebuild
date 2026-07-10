import { useState } from "react";
import { ChevronDown, ExternalLink, Eye, EyeOff, MoreHorizontal, Pencil, Plus, TerminalSquare, X } from "lucide-react";
import type { Session } from "../../lib/sessions";
import type { RecentProject } from "../../lib/projects";
import type { RepoIdentity } from "../../lib/repoIdentity";
import { RepoIcon } from "./RepoIcon";

type ProjectRowProps = {
  project: RecentProject;
  isActive: boolean;
  sessions: Session[];
  activeSessionId: string | null;
  identity: RepoIdentity | undefined;
  menuPath: string | null;
  hiddenPaths: Set<string>;
  editingSession: string | null;
  editValue: string;
  sessionMenu: string | null;
  onSelectProject: (path: string) => void;
  onCreateSession: () => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession?: (id: string) => void;
  onSetMenuPath: (path: string | null) => void;
  onToggleHide: (path: string) => void;
  onRemove: (path: string) => void;
  onReveal: (path: string) => void;
  onSetEditingSession: (id: string | null) => void;
  onSetEditValue: (value: string) => void;
  onSetSessionMenu: (id: string | null) => void;
};

function formatTime(ts: number): string {
  const date = new Date(ts * 1000);
  const now = Date.now();
  const diff = now - ts * 1000;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

export function ProjectRow({
  project,
  isActive,
  sessions,
  activeSessionId,
  identity,
  menuPath,
  hiddenPaths,
  editingSession,
  editValue,
  sessionMenu,
  onSelectProject,
  onCreateSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onSetMenuPath,
  onToggleHide,
  onRemove,
  onReveal,
  onSetEditingSession,
  onSetEditValue,
  onSetSessionMenu,
}: ProjectRowProps) {
  const [sessionsExpanded, setSessionsExpanded] = useState(true);
  const repoName = identity?.name ?? project.name;
  const branch = identity?.branch ?? null;
  const repoHost = identity?.host ?? "folder";

  return (
    <div className="sidebar-project-group">
      <div
        className={`sidebar-item${isActive ? " is-active" : " is-inactive"}`}
        onContextMenu={(e) => { e.preventDefault(); onSetMenuPath(menuPath === project.path ? null : project.path); }}
      >
        <button
          className="sidebar-item-main"
          type="button"
          title={project.path}
          onClick={() => onSelectProject(project.path)}
        >
          <RepoIcon host={repoHost} size={14} />
          <span className="sidebar-repo-name">{repoName}</span>
          {branch ? <span className="sidebar-repo-branch" title={`Branch: ${branch}`}>{branch}</span> : null}
          {sessions.length > 0 ? (
            <span className="sidebar-session-count">{sessions.length}</span>
          ) : null}
        </button>
        {sessions.length > 0 ? (
          <button
            className="sidebar-chevron-btn"
            title={sessionsExpanded ? "Collapse sessions" : "Expand sessions"}
            type="button"
            onClick={(e) => { e.stopPropagation(); setSessionsExpanded((v) => !v); }}
          >
            <ChevronDown size={12} className={`sidebar-chevron${sessionsExpanded ? "" : " is-collapsed"}`} />
          </button>
        ) : null}
        {isActive ? (
          <button
            className="btn-icon btn-icon-sm sidebar-item-more"
            title="New session"
            aria-label="New session"
            type="button"
            onClick={(e) => { e.stopPropagation(); onCreateSession(); }}
          >
            <Plus size={14} />
          </button>
        ) : null}
        <button
          className="btn-icon btn-icon-sm sidebar-item-more"
          title="More options"
          aria-label="More options"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSetMenuPath(menuPath === project.path ? null : project.path);
          }}
        >
          <MoreHorizontal size={14} />
        </button>
        {menuPath === project.path ? (
          <div className="context-menu" onMouseLeave={() => onSetMenuPath(null)}>
            <button className="menu-item" type="button" title="Open project in file explorer" onClick={() => onReveal(project.path)}>
              <ExternalLink size={13} /> Open in explorer
            </button>
            <button className="menu-item" type="button" title={hiddenPaths.has(project.path) ? "Show project in list" : "Hide project from list"} onClick={() => onToggleHide(project.path)}>
              {hiddenPaths.has(project.path) ? <Eye size={13} /> : <EyeOff size={13} />}
              {hiddenPaths.has(project.path) ? "Show in list" : "Hide from list"}
            </button>
            <button className="menu-item menu-item-danger" type="button" title="Remove project from list" onClick={() => onRemove(project.path)}>
              <X size={13} /> Remove
            </button>
          </div>
        ) : null}
      </div>

      {sessionsExpanded && sessions.length > 0 ? (
        <div className="sidebar-sessions">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`sidebar-session${s.id === activeSessionId ? " is-active" : ""}`}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSetSessionMenu(sessionMenu === s.id ? null : s.id);
              }}
            >
              {editingSession === s.id ? (
                <input
                  className="sidebar-session-edit"
                  type="text"
                  value={editValue}
                  autoFocus
                  onChange={(e) => onSetEditValue(e.target.value)}
                  onBlur={() => {
                    if (editValue.trim()) onRenameSession(s.id, editValue.trim());
                    onSetEditingSession(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (editValue.trim()) onRenameSession(s.id, editValue.trim());
                      onSetEditingSession(null);
                    } else if (e.key === "Escape") {
                      onSetEditingSession(null);
                    }
                  }}
                />
              ) : (
                <button
                  className="sidebar-session-main"
                  type="button"
                  title={s.title}
                  onClick={() => onSelectSession(s.id)}
                  onDoubleClick={() => {
                    onSetEditingSession(s.id);
                    onSetEditValue(s.title);
                  }}
                >
                  <TerminalSquare size={12} className="sidebar-session-icon" />
                  <span className="sidebar-session-title">{s.title}</span>
                  <span className="sidebar-session-time">{formatTime(s.updatedAt)}</span>
                </button>
              )}
              {editingSession !== s.id ? (
                <button
                  className="btn-icon btn-icon-sm sidebar-session-edit-btn"
                  title="Rename"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetEditingSession(s.id);
                    onSetEditValue(s.title);
                  }}
                >
                  <Pencil size={10} />
                </button>
              ) : null}
              {sessionMenu === s.id ? (
                <div className="context-menu" onMouseLeave={() => onSetSessionMenu(null)}>
                  <button className="menu-item" type="button" title="Rename session" onClick={() => {
                    onSetEditingSession(s.id);
                    onSetEditValue(s.title);
                    onSetSessionMenu(null);
                  }}>
                    <Pencil size={13} /> Rename
                  </button>
                  {onDeleteSession ? (
                    <button className="menu-item menu-item-danger" type="button" title="Delete session" onClick={() => {
                      if (confirm(`Delete session "${s.title}"? This cannot be undone.`)) {
                        onDeleteSession(s.id);
                      }
                      onSetSessionMenu(null);
                    }}>
                      <X size={13} /> Delete
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
