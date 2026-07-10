import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FolderPlus,
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
import { useLogs } from "../../state/log";
import { RepoIcon } from "./RepoIcon";
import { getRepoIdentity, type RepoIdentity } from "../../lib/repoIdentity";
import { ProjectRow } from "./ProjectRow";

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
  onDeleteSession?: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

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
  onDeleteSession,
  collapsed,
  onToggleCollapse,
}: ProjectSidebarProps) {
  const [hiddenPaths, setHiddenPaths] = useState<Set<string>>(new Set());
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [repoIdentities, setRepoIdentities] = useState<Map<string, RepoIdentity>>(new Map());
  const [editingSession, setEditingSession] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [sessionMenu, setSessionMenu] = useState<string | null>(null);
  const visibleProjects = projects.filter((p) => !hiddenPaths.has(p.path));

  // Fetch repo identity (host, name, branch) for all visible projects.
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      visibleProjects.map(async (p) => {
        try {
 const identity = await getRepoIdentity(p.path);
 return [p.path, identity] as [string, RepoIdentity | null];
        } catch {
 return [p.path, null] as [string, RepoIdentity | null];
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const map = new Map<string, RepoIdentity>();
      for (const [path, identity] of entries) {
        if (identity) map.set(path, identity);
      }
      setRepoIdentities(map);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.length]);

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
          visibleProjects.map((project) => (
            <ProjectRow
              key={project.path}
              project={project}
              isActive={project.path === activeProjectPath}
              sessions={sessionsByProject.get(project.path) ?? []}
              activeSessionId={activeSessionId}
              identity={repoIdentities.get(project.path)}
              menuPath={menuPath}
              hiddenPaths={hiddenPaths}
              editingSession={editingSession}
              editValue={editValue}
              sessionMenu={sessionMenu}
              onSelectProject={onSelectProject}
              onCreateSession={onCreateSession}
              onSelectSession={onSelectSession}
              onRenameSession={onRenameSession}
              onDeleteSession={onDeleteSession}
              onSetMenuPath={setMenuPath}
              onToggleHide={toggleHide}
              onRemove={handleRemove}
              onReveal={handleReveal}
              onSetEditingSession={setEditingSession}
              onSetEditValue={setEditValue}
              onSetSessionMenu={setSessionMenu}
            />
          ))
        )}
        {hiddenPaths.size > 0 ? (
          <button className="sidebar-show-hidden" type="button" title="Show hidden projects" onClick={() => setHiddenPaths(new Set())}>
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
  const [pickerInFlight, setPickerInFlight] = useState(false);
  const pickerPromiseRef = useRef<Promise<string | null> | null>(null);
  const { addLog } = useLogs();

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
      addLog("info", `Project selected: ${path}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog("error", `Failed to detect project ${path}`, message);
      setProjectDetection(null);
    }
  }

  async function openFolder() {
    // Single-flight: if a picker is already open, return the same promise so
    // repeated clicks coalesce into one dialog. Tauri's native picker is
    // modal but rapid clicks can still queue duplicate invocations.
    if (pickerPromiseRef.current) {
      addLog("debug", "Folder picker already open — reusing in-flight promise");
      return pickerPromiseRef.current;
    }
    setPickerInFlight(true);
    const promise = (async () => {
      addLog("info", "Opening folder picker...");
      try {
        const path = await pickProjectDirectory();
        if (!path) {
          addLog("info", "No folder selected");
          return null;
        }
        addLog("info", `Folder selected: ${path}`);
        await rememberRecentProject(path);
        await refreshProjects();
        // Detection runs once via the `activeProjectPath` effect below; do not
        // call `selectProject` here — that would duplicate the diagnostic event.
        return path;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        addLog("error", "Folder picker failed", message);
        throw err;
      } finally {
        setPickerInFlight(false);
      }
    })();
    pickerPromiseRef.current = promise;
    promise.finally(() => {
      pickerPromiseRef.current = null;
    });
    return promise;
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

  return { projects, projectDetection, sessionsByProject, refreshProjects, refreshSessions, selectProject, removeProject, openFolder, pickerInFlight, isPickerInFlight: () => pickerPromiseRef.current !== null };
}
