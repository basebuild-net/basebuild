import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
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

type ProjectSidebarProps = {
  activeProjectPath: string | null;
  projects: RecentProject[];
  projectDetection: ProjectDetection | null;
  onSelectProject: (path: string) => void;
  onOpenFolder: () => void;
  onRemoveProject: (path: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

export function ProjectSidebar({
  activeProjectPath,
  projects,
  projectDetection,
  onSelectProject,
  onOpenFolder,
  onRemoveProject,
  collapsed,
  onToggleCollapse,
}: ProjectSidebarProps) {
  const [hiddenPaths, setHiddenPaths] = useState<Set<string>>(new Set());
  const [menuPath, setMenuPath] = useState<string | null>(null);

  const visibleProjects = projects.filter((p) => !hiddenPaths.has(p.path));

  function toggleHide(path: string) {
    setHiddenPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    setMenuPath(null);
  }

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
        <button
          className="btn-icon"
          title="Open folder"
          aria-label="Open folder"
          type="button"
          onClick={onOpenFolder}
        >
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
          visibleProjects.map((project) => (
            <div
              key={project.path}
              className={`sidebar-item${project.path === activeProjectPath ? " is-active" : ""}`}
            >
              <button
                className="sidebar-item-main"
                type="button"
                title={project.path}
                onClick={() => onSelectProject(project.path)}
              >
                <FolderOpen size={14} className="sidebar-item-icon" />
                <span className="sidebar-item-label">{project.name}</span>
              </button>
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
          ))
        )}
        {hiddenPaths.size > 0 ? (
          <button className="sidebar-show-hidden" type="button" onClick={() => setHiddenPaths(new Set())}>
            <Eye size={13} /> Show {hiddenPaths.size} hidden
          </button>
        ) : null}
      </div>

      {activeProjectPath && projectDetection ? (
        <div className="sidebar-detection">
          <div className={`pill${projectDetection.hasGit ? " is-ok" : ""}`} title="Git repository">
            Git
          </div>
          <div className={`pill${projectDetection.hasOpenSpec ? " is-ok" : ""}`} title="OpenSpec config present">
            OpenSpec
          </div>
          <div className={`pill${projectDetection.hasBasebuild ? " is-ok" : ""}`} title=".basebuild config present">
            .basebuild
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export function useProjectSidebar(activeProjectPath: string | null) {
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const [projectDetection, setProjectDetection] = useState<ProjectDetection | null>(null);

  async function refreshProjects() {
    try {
      setProjects(await listRecentProjects());
    } catch {
      // ignore
    }
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

  return { projects, projectDetection, refreshProjects, selectProject, removeProject, openFolder };
}
