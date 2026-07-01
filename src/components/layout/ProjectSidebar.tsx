import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  TerminalSquare,
  X,
} from "lucide-react";

import {
  detectProject,
  listRecentProjects,
  pickProjectDirectory,
  rememberRecentProject,
  removeRecentProject,
  revealInExplorer,
  type ProjectDetection,
  type RecentProject,
} from "../../lib/projects";
import { listSessions, type Session } from "../../lib/sessions";

type ProjectSidebarProps = {
  activeProjectPath: string | null;
  activeSessionId: string | null;
  projects: RecentProject[];
  projectDetection: ProjectDetection | null;
  sessionsByProject: Map<string, Session[]>;
  onSelectProject: (path: string) => void;
  onOpenFolder: () => void;
  onRemoveProject: (path: string) => void;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onRenameSession: (id: string, title: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
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

export function ProjectSidebar({
  activeProjectPath,
  activeSessionId,
  projects,
  projectDetection,
  sessionsByProject,
  onSelectProject,
  onOpenFolder,
  onRemoveProject,
  onSelectSession,
  onCreateSession,
  onRenameSession,
  collapsed,
  onToggleCollapse,
}: ProjectSidebarProps) {
  const [hiddenPaths, setHiddenPaths] = useState<Set<string>>(new Set());
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [editingSession, setEditingSession] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const visibleProjects = projects.filter((p) => !hiddenPaths.has(p.path));

  async function handleReveal(path: string) {
    try {
      await revealInExplorer(path);
    } catch {
      // ignore
    }
    setMenuPath(null);
  }

  function handleRemove(path: string) {
    onRemoveProject(path);
    setMenuPath(null);
  }

  return (
    <aside className="sidebar" aria-label="Projects">
      <div className="sidebar-header">
        <span className="sidebar-title">Projects</span>
        <button className="btn-icon" title="Open folder" aria-label="Open folder" type="button" onClick={onOpenFolder}>
          <FolderPlus size={15} />
        </button>
        <button
          className="btn-icon"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          type="button"
          onClick={onToggleCollapse}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>

      <div className="sidebar-list">
        {visibleProjects.length === 0 ? (
          <p className="text-muted text-sm pad sidebar-empty">No projects yet.</p>
        ) : (
          visibleProjects.map((project) => {
            const isActive = project.path === activeProjectPath;
            const projectSessions = sessionsByProject.get(project.path) ?? [];
            const isCollapsed = collapsedProjects.has(project.path);
            return (
              <div key={project.path} className="sidebar-project-group">
                <div className={`sidebar-item${isActive ? " is-active" : ""}`}>
                  {/* Collapse chevron */}
                  <button
                    className="sidebar-chevron-btn"
                    title={isCollapsed ? "Expand" : "Collapse"}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCollapsedProjects((prev) => {
                        const next = new Set(prev);
                        if (next.has(project.path)) next.delete(project.path);
                        else next.add(project.path);
                        return next;
                      });
                    }}
                  >
                    <ChevronDown size={12} className={`sidebar-chevron${isCollapsed ? " is-collapsed" : ""}`} />
                  </button>
                  <button
                    className="sidebar-item-main"
                    type="button"
                    title={project.path}
                    onClick={() => onSelectProject(project.path)}
                  >
                    <FolderOpen size={14} className="sidebar-item-icon" />
                    <span className="sidebar-item-label">{project.name}</span>
                    {projectSessions.length > 0 ? (
                      <span className="sidebar-session-count">{projectSessions.length}</span>
                    ) : null}
                  </button>
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
                      setMenuPath(menuPath === project.path ? null : project.path);
                    }}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  {menuPath === project.path ? (
                    <div className="context-menu" onMouseLeave={() => setMenuPath(null)}>
                      <button className="menu-item" type="button" onClick={() => handleReveal(project.path)}>
                        <ExternalLink size={13} /> Open in explorer
                      </button>
                      <button className="menu-item" type="button" onClick={() => toggleHide(project.path)}>
                        {hiddenPaths.has(project.path) ? <Eye size={13} /> : <EyeOff size={13} />}
                        {hiddenPaths.has(project.path) ? "Show in list" : "Hide from list"}
                      </button>
                      <button className="menu-item menu-item-danger" type="button" onClick={() => handleRemove(project.path)}>
                        <X size={13} /> Remove
                      </button>
                    </div>
                  ) : null}
                </div>

                {/* Sessions under project (collapsible) */}
                {!isCollapsed && projectSessions.length > 0 ? (
                  <div className="sidebar-sessions">
                    {projectSessions.map((s) => (
                      <div
                        key={s.id}
                        className={`sidebar-session${s.id === activeSessionId ? " is-active" : ""}`}
                      >
                        {editingSession === s.id ? (
                          <input
                            className="sidebar-session-edit"
                            type="text"
                            value={editValue}
                            autoFocus
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => {
                              if (editValue.trim()) onRenameSession(s.id, editValue.trim());
                              setEditingSession(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                if (editValue.trim()) onRenameSession(s.id, editValue.trim());
                                setEditingSession(null);
                              } else if (e.key === "Escape") {
                                setEditingSession(null);
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
                              setEditingSession(s.id);
                              setEditValue(s.title);
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
                              setEditingSession(s.id);
                              setEditValue(s.title);
                            }}
                          >
                            <Pencil size={10} />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
        {hiddenPaths.size > 0 ? (
          <button className="sidebar-show-hidden" type="button" onClick={() => setHiddenPaths(new Set())}>
            <Eye size={13} /> Show {hiddenPaths.size} hidden
          </button>
        ) : null}
      </div>

      {activeProjectPath && projectDetection ? (
        <div className="sidebar-detection">
          <div className={`pill${projectDetection.hasGit ? " is-ok" : ""}`} title="Git repository">Git</div>
          <div className={`pill${projectDetection.hasOpenSpec ? " is-ok" : ""}`} title="OpenSpec config present">OpenSpec</div>
          <div className={`pill${projectDetection.hasBasebuild ? " is-ok" : ""}`} title=".basebuild config present">.basebuild</div>
        </div>
      ) : null}
    </aside>
  );

  function toggleHide(path: string) {
    setHiddenPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    setMenuPath(null);
  }
}

export function useProjectSidebar(activeProjectPath: string | null) {
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const [projectDetection, setProjectDetection] = useState<ProjectDetection | null>(null);
  const [sessionsByProject, setSessionsByProject] = useState<Map<string, Session[]>>(new Map());

  async function refreshProjects() {
    try {
      const list = await listRecentProjects();
      setProjects(list);
      // Fetch sessions for ALL projects in parallel
      const entries = await Promise.all<[string, Session[]]>(
        list.map(async (p) => {
          try {
            const sessions = await listSessions(p.path);
            return [p.path, sessions] as [string, Session[]];
          } catch {
            return [p.path, [] as Session[]] as [string, Session[]];
          }
        }),
      );
      setSessionsByProject(new Map(entries));
    } catch {
      // ignore
    }
  }

  async function refreshSessions() {
    // Re-fetch sessions for all projects
    await refreshProjects();
  }

  async function selectProject(path: string) {
    try {
      const detection = await detectProject(path);
      setProjectDetection(detection);
    } catch {
      setProjectDetection(null);
    }
  }

  async function openFolder() {
    const path = await pickProjectDirectory();
    if (!path) return null;
    await rememberRecentProject(path);
    await refreshProjects();
    await selectProject(path);
    return path;
  }

  async function removeProject(path: string) {
    await removeRecentProject(path);
    await refreshProjects();
  }

  useEffect(() => {
    void refreshProjects();
  }, []);

  useEffect(() => {
    if (activeProjectPath) {
      void selectProject(activeProjectPath);
    } else {
      setProjectDetection(null);
    }
  }, [activeProjectPath]);

  return { projects, projectDetection, sessionsByProject, refreshProjects, refreshSessions, selectProject, removeProject, openFolder };
}
