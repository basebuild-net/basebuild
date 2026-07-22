import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Link2,
  FileText,
  GitBranch,
  FolderPlus,
  FlaskConical,
  MessageSquare,
  MoreVertical,
  Unlink,
  Pin,
  Plus,
  RotateCcw,
  Settings2,
  TerminalSquare,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AccountButton } from "./AccountButton";
import { ConfirmDialog } from "./ConfirmDialog";
import { StatusBar } from "./StatusBar";
import { UpdateButton } from "./UpdateButton";
import { RepoIcon } from "./RepoIcon";
import { ActionMenu, type ActionMenuItem } from "../ActionMenu";
import { getRepoIdentity, type RepoIdentity } from "../../lib/repoIdentity";
import { humanizeChatTitle } from "../../lib/titles";
import { getWorkspaceRestoreState } from "../../lib/workspace";
import {
  flattenLeaves,
  migrateFromLegacyBlob,
  visibleSurfaceIds,
  type ClosedSurfaceRecord,
  type SplitDirection,
  type SurfaceKind,
  type SurfaceRecord,
  type WorkspaceState,
} from "../../lib/workspaceState";
import { formatRelativeTime } from "../../lib/timing";
import type { AccountState } from "../../state/account";
import type { UpdaterState } from "../../state/updater";
import type { RecentProject } from "../../lib/projects";

const PINNED_PROJECTS_KEY = "basebuild.pinned-projects.v1";

function readPinnedProjects(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PINNED_PROJECTS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set();
  }
}

function writePinnedProjects(pinned: Set<string>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PINNED_PROJECTS_KEY, JSON.stringify(Array.from(pinned)));
  } catch {
    // ignore
  }
}

// ── Surface kind presentation ───────────────────────────────────────────────

const surfaceKindIcon: Record<SurfaceKind, LucideIcon> = {
  chat: MessageSquare,
  "omp-chat": Zap,
  terminal: TerminalSquare,
};

const surfaceKindLabel: Record<SurfaceKind, string> = {
  chat: "Chat",
  "omp-chat": "Oh My Pi Chat",
  terminal: "Terminal",
};

/** A neutral, non-decorative display title for a surface. Honors manual title
 *  lock by using `title` as-is; falls back to a kind-labeled placeholder. */
function surfaceDisplayTitle(surface: SurfaceRecord): string {
  if (surface.title) return humanizeChatTitle(surface.title);
  return `Untitled ${surfaceKindLabel[surface.kind]}`;
}

/** Disambiguate identical display titles across a set of surfaces by
 *  appending a 1-based index. Placeholder surfaces are differentiated by
 *  their kind label rather than decorative colors. */
function buildDisplayTitles(surfaces: SurfaceRecord[]): Map<string, string> {
  const display = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const s of surfaces) {
    const base = surfaceDisplayTitle(s);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  for (const s of surfaces) {
    const base = surfaceDisplayTitle(s);
    const count = counts.get(base) ?? 1;
    if (count > 1) {
      const idx = (seen.get(base) ?? 0) + 1;
      seen.set(base, idx);
      display.set(s.id, `${base} (${idx})`);
    } else {
      display.set(s.id, base);
    }
  }
  return display;
}


// ── Props ───────────────────────────────────────────────────────────────────

export type ActivitySidebarProps = {
  activeProjectPath: string | null;
  /** The active project's workspace state (active registry + visible tree +
   *  history). The sidebar renders surfaces from this, not from legacy tabs. */
  workspaceState: WorkspaceState;
  // Surface lifecycle actions — all operate against surface identity.
  onFocusSurface: (surfaceId: string) => void;
  onReplaceFocusedSurface: (surfaceId: string) => void;
  onSplitFocusedSurface: (surfaceId: string, direction: SplitDirection) => void;
  onGroupSurface: (surfaceId: string, targetSurfaceId: string, side: "left" | "right" | "top" | "bottom") => void;
  onRemoveSurfaceFromLayout: (surfaceId: string) => void;
  onCloseSurface: (surfaceId: string) => void;
  onReopenSurface: (surfaceId: string) => void;
  onDeleteSurfaceFromHistory: (surfaceId: string) => void;
  // Project-level props
  projects: RecentProject[];
  account: AccountState;
  updates: UpdaterState;
  onSelectProject: (path: string) => void;
  onOpenFolder: () => void;
  onTestRunMode?: () => void;
  onRemoveProject?: (path: string) => void;
  onOpenInExplorer?: (path: string) => void;
  onCopyProjectPath?: (path: string) => void;
  onNewChat?: (path: string) => void;
  onOpenFiles?: (path: string) => void;
  onOpenChanges?: (path: string) => void;
  pickerInFlight: boolean;
  onCreateChat: () => void;
  /** Add a new linked chat to the active group (split focused surface). */
  onAddLinkedChat: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenLogPanel: () => void;
  onClearChats?: (path: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

// ── Project menu (stripped of decorative color labels) ──────────────────────

function ProjectMenuButton({
  projectPath,
  projectName,
  onOpenInExplorer,
  onRemoveProject,
  onCopyPath,
  onNewChat,
  onOpenFiles,
  onOpenChanges,
  onClearChats,
  isPinned,
  onTogglePin,
}: {
  projectPath: string;
  projectName: string;
  onOpenInExplorer?: (path: string) => void;
  onRemoveProject?: (path: string) => void;
  onCopyPath?: (path: string) => void;
  onNewChat?: (path: string) => void;
  onOpenFiles?: (path: string) => void;
  onOpenChanges?: (path: string) => void;
  onClearChats?: (path: string) => void;
  isPinned?: boolean;
  onTogglePin?: (path: string) => void;
}) {
  const items: ActionMenuItem[] = [];
  if (onNewChat) items.push({
    key: "new-chat",
    label: "Add chat window",
    title: "Add a chat window to this project",
    icon: <Plus size={11} />,
    onSelect: () => onNewChat(projectPath),
  });
  if (onOpenFiles) items.push({
    key: "files",
    label: "Files",
    title: "Browse files in this project",
    icon: <FileText size={11} />,
    onSelect: () => onOpenFiles(projectPath),
  });
  if (onOpenChanges) items.push({
    key: "changes",
    label: "Changes",
    title: "View git changes in this project",
    icon: <GitBranch size={11} />,
    onSelect: () => onOpenChanges(projectPath),
  });
  if (onCopyPath) items.push({
    key: "copy-path",
    label: "Copy project path",
    title: "Copy the project folder path",
    icon: <Copy size={11} />,
    onSelect: () => onCopyPath(projectPath),
  });
  if (onOpenInExplorer) items.push({
    key: "explorer",
    label: "Open in Explorer",
    title: "Open this project folder in the file explorer",
    icon: <FolderPlus size={11} />,
    onSelect: () => onOpenInExplorer(projectPath),
  });
  if (onTogglePin) items.push({
    key: "pin",
    label: isPinned ? "Unpin" : "Pin",
    title: isPinned ? "Unpin project from top of list" : "Pin project to top of list",
    icon: <Pin size={11} />,
    onSelect: () => onTogglePin(projectPath),
  });
  if (onClearChats) items.push({
    key: "clear-chats",
    label: "Clear chats",
    title: "Clear all chats for this project",
    icon: <TerminalSquare size={11} />,
    danger: true,
    onSelect: () => onClearChats(projectPath),
  });
  if (onRemoveProject) items.push({
    key: "remove",
    label: "Remove project",
    title: `Remove ${projectName} from the sidebar (does not delete files)`,
    icon: <Trash2 size={11} />,
    danger: true,
    onSelect: () => onRemoveProject(projectPath),
  });
  if (items.length === 0) return null;

  return (
    <span className="project-menu-wrap">
      <ActionMenu
        items={items}
        triggerTitle={`Manage ${projectName}`}
        triggerClassName="project-menu-btn"
        icon={<MoreVertical size={12} />}
      />
    </span>
  );
}

// ── Surface row actions (inline, revealed on hover/focus-within) ────────────

function SurfaceActionButtons({
  surfaceId,
  onClose,
}: {
  surfaceId: string;
  onClose: (surfaceId: string) => void;
}) {
  return (
    <span className="surface-row-actions" aria-hidden={false}>
      <button
        className="surface-row-action-btn is-danger"
        type="button"
        title="Close to History"
        onClick={(e) => { e.stopPropagation(); onClose(surfaceId); }}
      >
        <X size={11} />
      </button>
    </span>
  );
}

// ── History row ─────────────────────────────────────────────────────────────

function HistoryRow({
  record,
  onReopen,
  onDelete,
}: {
  record: ClosedSurfaceRecord;
  onReopen: (surfaceId: string) => void;
  onDelete: (surfaceId: string) => void;
}) {
  const Icon = surfaceKindIcon[record.kind];
  const title = surfaceDisplayTitle(record);
  return (
    <div
      className="surface-row is-history"
      title={`${title} — closed ${formatRelativeTime(record.closedAt)}`}
    >
      <Icon size={11} className="surface-row-icon" />
      <span className="surface-row-title">{title}</span>
      <span className="surface-row-actions">
        <button
          className="surface-row-action-btn"
          type="button"
          title="Reopen as active hidden (preserves current layout)"
          onClick={(e) => { e.stopPropagation(); onReopen(record.id); }}
        >
          <RotateCcw size={11} />
        </button>
        <button
          className="surface-row-action-btn is-danger"
          type="button"
          title="Permanently delete from history"
          onClick={(e) => { e.stopPropagation(); onDelete(record.id); }}
        >
          <Trash2 size={11} />
        </button>
      </span>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function ActivitySidebar({
  activeProjectPath,
  workspaceState,
  onFocusSurface,
  onReplaceFocusedSurface,
  onGroupSurface,
  onSplitFocusedSurface,
  onRemoveSurfaceFromLayout,
  onCloseSurface,
  onReopenSurface,
  onDeleteSurfaceFromHistory,
  projects,
  account,
  updates,
  onSelectProject,
  onOpenFolder,
  onTestRunMode,
  onRemoveProject,
  onOpenInExplorer,
  onCopyProjectPath,
  onNewChat,
  onOpenFiles,
  onOpenChanges,
  pickerInFlight,
  onCreateChat,
  onAddLinkedChat,
  onOpenLogPanel,
  onClearChats,
  onOpenHistory,
  onOpenSettings,
  collapsed,
  onToggleCollapse,
}: ActivitySidebarProps) {
  const [repoIdentities, setRepoIdentities] = useState<Map<string, RepoIdentity>>(new Map());
  const [pinnedPaths, setPinnedPaths] = useState<Set<string>>(readPinnedProjects);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [, setClock] = useState(0);

  useEffect(() => { writePinnedProjects(pinnedPaths); }, [pinnedPaths]);

  const togglePin = useCallback((path: string) => {
    setPinnedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Fetch repo identity (host, name, branch) for all projects.
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      projects.map(async (p) => {
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
  }, [projects]);

  // Fetch active surfaces for each non-active project from its saved workspace
  // blob (v2 or legacy). Polls every 5s so run state stays live.
  const [otherProjectSurfaces, setOtherProjectSurfaces] = useState<Map<string, SurfaceRecord[]>>(new Map());
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function fetchOtherSurfaces() {
      const otherProjects = projects.filter((p) => p.path !== activeProjectPath);
      if (otherProjects.length === 0) {
        setOtherProjectSurfaces(new Map());
        return;
      }
      const entries = await Promise.all(
        otherProjects.map(async (p): Promise<[string, SurfaceRecord[]]> => {
          try {
            const restore = await getWorkspaceRestoreState(p.path);
            const result = migrateFromLegacyBlob(restore.panelGrid ?? null, p.path);
            const surfaces = Object.values(result.state.activeSurfaces);
            return [p.path, surfaces];
          } catch {
            return [p.path, []];
          }
        }),
      );
      if (cancelled) return;
      const map = new Map<string, SurfaceRecord[]>();
      for (const [path, surfaces] of entries) {
        map.set(path, surfaces);
      }
      setOtherProjectSurfaces(map);
    }
    void fetchOtherSurfaces();
    timer = window.setInterval(() => void fetchOtherSurfaces(), 5000);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [projects, activeProjectPath]);

  // Tick a clock every 15s so relative times in history refresh.
  useEffect(() => {
    const id = window.setInterval(() => setClock((c) => c + 1), 15000);
    return () => window.clearInterval(id);
  }, []);

  // ── Derive visible + hidden surfaces for the active project ───────────────

  const visibleLeaves = useMemo(
    () => flattenLeaves(workspaceState.visibleTree),
    [workspaceState.visibleTree],
  );
  const visibleIds = useMemo(
    () => visibleSurfaceIds(workspaceState.visibleTree),
    [workspaceState.visibleTree],
  );

  // Stashed tree: a linked group that was swapped out when the user clicked
  // an unlinked chat. Its surfaces show in the sidebar as a "Linked group"
  // and clicking any of them restores the whole group.
  const stashedLeaves = useMemo(
    () => workspaceState.stashedTree ? flattenLeaves(workspaceState.stashedTree) : [],
    [workspaceState.stashedTree],
  );
  const stashedIds = useMemo(
    () => new Set(stashedLeaves.map((l) => l.surfaceId)),
    [stashedLeaves],
  );

  const activeSurfaceList = useMemo(
    () => Object.values(workspaceState.activeSurfaces),
    [workspaceState.activeSurfaces],
  );

  // Disambiguate titles across all active surfaces + history.
  const displayTitles = useMemo(() => {
    const historySurfaces = workspaceState.history.map((h) => h as SurfaceRecord);
    return buildDisplayTitles([...activeSurfaceList, ...historySurfaces]);
  }, [activeSurfaceList, workspaceState.history]);

  const hiddenSurfaces = useMemo(() => {
    return activeSurfaceList
      .filter((s) => !visibleIds.has(s.id) && !stashedIds.has(s.id))
      .sort((a, b) => b.lastFocusedAt - a.lastFocusedAt);
  }, [activeSurfaceList, visibleIds, stashedIds]);
  const focusedSurfaceId = workspaceState.focusedSurfaceId;

  // Confirm dialog for permanent history deletion.
  const deleteTarget = useMemo(
    () => workspaceState.history.find((h) => h.id === deleteConfirmId) ?? null,
    [workspaceState.history, deleteConfirmId],
  );

  const handleConfirmDelete = useCallback(() => {
    if (deleteConfirmId) {
      onDeleteSurfaceFromHistory(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  }, [deleteConfirmId, onDeleteSurfaceFromHistory]);

  // ── Collapsed sidebar ─────────────────────────────────────────────────────

  if (collapsed) {
    return (
      <aside className="project-chat-sidebar is-collapsed" aria-label="Activity sidebar (collapsed)">
        <div className="sidebar-top-actions">
          <button className="btn-icon" type="button" title="Add chat window" onClick={onCreateChat} disabled={!activeProjectPath}>
            <Plus size={14} />
          </button>
          <button className="btn-icon" type="button" title="History" onClick={onOpenHistory}>
            <Clock size={14} />
          </button>
          <button className="btn-icon" type="button" title={pickerInFlight ? "Opening folder picker…" : "Add project folder"} onClick={onOpenFolder} disabled={pickerInFlight}>
            <FolderPlus size={14} />
          </button>
          {onTestRunMode ? (
            <button className="btn-icon" type="button" title="Test Run Mode: create a test project and run the full plan lifecycle" onClick={onTestRunMode}>
              <FlaskConical size={14} />
            </button>
          ) : null}
          <button className="btn-icon" type="button" title="Expand sidebar" onClick={onToggleCollapse}>
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="sidebar-collapsed-spacer" />
        <div className="sidebar-bottom-account">
          <button className="btn-icon" type="button" title="Settings" onClick={onOpenSettings}>
            <Settings2 size={14} />
          </button>
          {updates.status === "downloaded" || updates.status === "installing" ? (
            <button
              className="update-taskbar-btn"
              type="button"
              title={`Basebuild ${updates.info?.version ?? ""} is downloaded — click to restart and apply it`}
              onClick={() => void updates.restartToApply()}
              disabled={updates.status === "installing"}
            >
              <span>{updates.status === "installing" ? "…" : "↻"}</span>
            </button>
          ) : null}
        </div>
      </aside>
    );
  }

  // ── Expanded sidebar ──────────────────────────────────────────────────────

  const activeIdentity = activeProjectPath ? repoIdentities.get(activeProjectPath) : undefined;
  const activeName = activeIdentity?.name ?? projects.find((p) => p.path === activeProjectPath)?.name ?? activeProjectPath?.split(/[\\/]/).pop() ?? "Project";
  const activeBranch = activeIdentity?.branch ?? null;
  const activeHost = activeIdentity?.host ?? "folder";

  return (
    <aside className="project-chat-sidebar" aria-label="Activity sidebar">
      <div className="sidebar-top-actions">
        <button className="btn btn-ghost btn-sm" type="button" title="Add chat window" onClick={onCreateChat} disabled={!activeProjectPath}>
          <Plus size={12} /> Add chat window
        </button>
        <button className="btn-icon" type="button" title={pickerInFlight ? "Opening folder picker…" : "Add project folder"} onClick={onOpenFolder} disabled={pickerInFlight}>
          <FolderPlus size={14} />
        </button>
        {onTestRunMode ? (
          <button className="btn-icon" type="button" title="Test Run Mode: create a test project and run the full plan lifecycle" onClick={onTestRunMode}>
            <FlaskConical size={14} />
          </button>
        ) : null}
        <button className="btn-icon" type="button" title="Collapse sidebar" onClick={onToggleCollapse}>
          <ChevronLeft size={14} />
        </button>
      </div>

      <div className="activity-sidebar">
        <div className="activity-sidebar-list">
          {projects.length === 0 ? (
            <div className="sidebar-empty text-muted text-sm">
              No projects yet. <button className="chat-link-btn" type="button" title="Add a project folder" onClick={onOpenFolder}>Add a folder</button>.
            </div>
          ) : (
            [...projects].sort((a, b) => {
              const aPinned = pinnedPaths.has(a.path);
              const bPinned = pinnedPaths.has(b.path);
              if (aPinned && !bPinned) return -1;
              if (!aPinned && bPinned) return 1;
              return a.name.localeCompare(b.name);
            }).map((project, projectIndex) => {
              const isActive = project.path === activeProjectPath;
              const identity = repoIdentities.get(project.path);
              const name = identity?.name ?? project.name;
              const branch = identity?.branch ?? null;
              const host = identity?.host ?? "folder";
              const otherSurfaces = !isActive
                ? otherProjectSurfaces.get(project.path) ?? []
                : [];
              const groupColorClass = isActive && visibleLeaves.length > 1
                ? ` surface-group-color-${projectIndex % 6}`
                : "";
              return (
                <div key={project.path} className={`activity-sidebar-project-row${isActive ? " is-active" : ""}${pinnedPaths.has(project.path) ? " is-pinned" : ""}${groupColorClass}`}>
                  <div
                    className="activity-sidebar-project-main"
                    title={project.path}
                    onClick={() => onSelectProject(project.path)}
                  >
                    <RepoIcon host={host} size={isActive ? 14 : 11} />
                    <span className={isActive ? "activity-sidebar-project-name" : "activity-sidebar-row-title"}>{name}</span>
                    {pinnedPaths.has(project.path) ? (
                      <Pin size={9} className="activity-sidebar-pin-indicator" aria-label="Pinned" />
                    ) : null}
                    <ProjectMenuButton
                      projectPath={project.path}
                      projectName={name}
                      onOpenInExplorer={onOpenInExplorer}
                      onRemoveProject={onRemoveProject}
                      onCopyPath={onCopyProjectPath}
                      onNewChat={onNewChat}
                      onOpenFiles={onOpenFiles}
                      onOpenChanges={onOpenChanges}
                      onClearChats={onClearChats}
                      isPinned={pinnedPaths.has(project.path)}
                      onTogglePin={togglePin}
                    />
                  </div>
                  {branch ? (
                    <span className="activity-sidebar-project-branch" title={`Branch: ${branch}`} onClick={() => onSelectProject(project.path)}>
                      {branch}
                    </span>
                  ) : null}

                  {/* Active project: render surfaces from workspaceState */}
                  {isActive ? (
                    <>
                      {visibleLeaves.length > 1 ? (
                        <div className="surface-group-label" title={`${visibleLeaves.length} chats linked in one layout`}>
                          <Link2 size={10} />
                          <span>Linked group</span>
                          <span className="surface-group-count">{visibleLeaves.length}</span>
                          <button
                            className="surface-group-add-btn"
                            type="button"
                            title="Add a linked chat to this group"
                            onClick={(e) => { e.stopPropagation(); onAddLinkedChat(); }}
                          >
                            <Plus size={10} />
                          </button>
                        </div>
                      ) : null}
                      {visibleLeaves.map((leaf) => {
                        const surface = workspaceState.activeSurfaces[leaf.surfaceId];
                        if (!surface) return null;
                        const Icon = surfaceKindIcon[surface.kind];
                        const isFocused = surface.id === focusedSurfaceId;
                        const title = displayTitles.get(surface.id) ?? surfaceDisplayTitle(surface);
                        return (
                          <div
                            key={leaf.id}
                            className={`surface-row is-visible${isFocused ? " is-focused" : ""}`}
                            role="button"
                            tabIndex={0}
                            draggable
                            data-surface-id={surface.id}
                            data-surface-visibility="visible"
                            title={`${title} — ${surfaceKindLabel[surface.kind]} (${visibleLeaves.length > 1 ? "linked" : "single"}${isFocused ? ", focused" : ""})`}
                            onClick={() => onFocusSurface(surface.id)}
                            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onFocusSurface(surface.id); } }}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("application/x-basebuild-surface", surface.id);
                              event.dataTransfer.setData("text/plain", surface.id);
                              document.body.dataset.surfaceDragging = "true";
                            }}
                            onDragEnd={() => { delete document.body.dataset.surfaceDragging; }}
                            onDragOver={(event) => {
                              if (event.dataTransfer.types.includes("text/plain")) event.preventDefault();
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const sourceId = event.dataTransfer.getData("text/plain")
                                || event.dataTransfer.getData("application/x-basebuild-surface");
                              if (sourceId && sourceId !== surface.id) onGroupSurface(sourceId, surface.id, "right");
                            }}
                          >
                            <span className="surface-row-connector" title={visibleLeaves.length > 1 ? "Linked in the current layout" : "Single chat"} aria-hidden="true">
                              {visibleLeaves.length > 1 ? <Link2 size={10} /> : null}
                            </span>
                            <Icon size={11} className="surface-row-icon" />
                            <span className="surface-row-title">{title}</span>
                            <SurfaceActionButtons
                              surfaceId={surface.id}
                              onClose={onCloseSurface}
                            />
                          </div>
                        );
                      })}

                      {visibleLeaves.length > 0 ? (
                        <div
                          className="surface-unlink-dropzone"
                          data-surface-unlink-dropzone
                          title="Drop a linked chat here to make it a separate active chat"
                          onDragOver={(event) => {
                            if (event.dataTransfer.types.includes("text/plain")) event.preventDefault();
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const sourceId = event.dataTransfer.getData("text/plain")
                              || event.dataTransfer.getData("application/x-basebuild-surface");
                            if (sourceId) onRemoveSurfaceFromLayout(sourceId);
                          }}
                        >
                          <Unlink size={10} />
                          <span>Drop here to unlink</span>
                        </div>
                      ) : null}

                      {stashedLeaves.length > 0 ? (
                        <>
                          <div className="surface-group-label is-stashed" title={`${stashedLeaves.length} chats linked in a stashed group — click any to restore the whole group`}>
                            <Link2 size={10} />
                            <span>Linked group</span>
                            <span className="surface-group-count">{stashedLeaves.length}</span>
                          </div>
                          {stashedLeaves.map((leaf) => {
                            const surface = workspaceState.activeSurfaces[leaf.surfaceId];
                            if (!surface) return null;
                            const Icon = surfaceKindIcon[surface.kind];
                            const title = displayTitles.get(surface.id) ?? surfaceDisplayTitle(surface);
                            return (
                              <div
                                key={leaf.id}
                                className="surface-row is-stashed"
                                role="button"
                                tabIndex={0}
                                data-surface-id={surface.id}
                                data-surface-visibility="stashed"
                                title={`${title} — ${surfaceKindLabel[surface.kind]} (stashed linked group; click to restore the whole group)`}
                                onClick={() => onFocusSurface(surface.id)}
                                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onFocusSurface(surface.id); } }}
                              >
                                <span className="surface-row-connector" title="Stashed linked group" aria-hidden="true">
                                  <Link2 size={10} />
                                </span>
                                <Icon size={11} className="surface-row-icon" />
                                <span className="surface-row-title">{title}</span>
                                <SurfaceActionButtons
                                  surfaceId={surface.id}
                                  onClose={onCloseSurface}
                                />
                              </div>
                            );
                          })}
                        </>
                      ) : null}

                      {hiddenSurfaces.length > 0 ? (
                        <div className="surface-group-label is-unlinked" title="Active chats not linked into the current layout">
                          <Unlink size={10} />
                          <span>Unlinked</span>
                          <span className="surface-group-count">{hiddenSurfaces.length}</span>
                        </div>
                      ) : null}
                      {hiddenSurfaces.map((surface) => {
                        const Icon = surfaceKindIcon[surface.kind];
                        const title = displayTitles.get(surface.id) ?? surfaceDisplayTitle(surface);
                        return (
                          <div
                            key={surface.id}
                            className="surface-row is-hidden"
                            role="button"
                            tabIndex={0}
                            draggable
                            data-surface-id={surface.id}
                            data-surface-visibility="hidden"
                            title={`${title} — ${surfaceKindLabel[surface.kind]} (unlinked; click to show only this chat, or drag onto a linked chat to group)`}
                            onClick={() => onReplaceFocusedSurface(surface.id)}
                            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onReplaceFocusedSurface(surface.id); } }}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("application/x-basebuild-surface", surface.id);
                              event.dataTransfer.setData("text/plain", surface.id);
                              document.body.dataset.surfaceDragging = "true";
                            }}
                            onDragEnd={() => { delete document.body.dataset.surfaceDragging; }}
                            onDragOver={(event) => {
                              if (event.dataTransfer.types.includes("text/plain")) event.preventDefault();
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const sourceId = event.dataTransfer.getData("text/plain")
                                || event.dataTransfer.getData("application/x-basebuild-surface");
                              if (sourceId && sourceId !== surface.id) onGroupSurface(sourceId, surface.id, "right");
                            }}
                          >
                            <span className="surface-row-connector" title="Unlinked active chat" aria-hidden="true">
                              <Unlink size={10} />
                            </span>
                            <Icon size={11} className="surface-row-icon" />
                            <span className="surface-row-title">{title}</span>
                            <SurfaceActionButtons
                              surfaceId={surface.id}
                              onClose={onCloseSurface}
                            />
                          </div>
                        );
                      })}

                      {/* Empty state */}
                      {visibleLeaves.length === 0 && hiddenSurfaces.length === 0 ? (
                        <div className="sidebar-empty text-muted text-sm">
                          No active surfaces. <button className="chat-link-btn" type="button" title="Start a new chat" onClick={onCreateChat}>Start a chat</button>.
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {/* Inactive project: show its active surfaces from saved workspace */}
                  {!isActive && otherSurfaces.length > 0 ? (
                    <div className="activity-sidebar-project-chats" aria-label={`${name} surfaces`}>
                      {otherSurfaces.map((surface) => {
                        const Icon = surfaceKindIcon[surface.kind];
                        const title = surfaceDisplayTitle(surface);
                        return (
                          <div
                            key={surface.id}
                            className="surface-row is-other-project"
                            title={`${title} — ${surfaceKindLabel[surface.kind]}`}
                            onClick={() => onSelectProject(project.path)}
                          >
                            <Icon size={10} className="surface-row-icon" />
                            <span className="surface-row-title">{title}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {/* History section — separate collapsed/drawer destination */}
        {workspaceState.history.length > 0 ? (
          <div className="surface-history-section">
            <button
              className="surface-history-header"
              type="button"
              title={historyExpanded ? "Collapse history" : `Expand history (${workspaceState.history.length} closed surface${workspaceState.history.length === 1 ? "" : "s"})`}
              aria-expanded={historyExpanded}
              onClick={() => setHistoryExpanded((v) => !v)}
            >
              <ChevronDown size={11} className={historyExpanded ? "surface-history-chevron" : "surface-history-chevron is-collapsed"} />
              <Clock size={11} />
              <span>History</span>
              <span className="surface-history-badge">{workspaceState.history.length}</span>
            </button>
            {historyExpanded ? (
              <div className="surface-history-list">
                {workspaceState.history.map((record) => (
                  <HistoryRow
                    key={record.id}
                    record={record}
                    onReopen={onReopenSurface}
                    onDelete={setDeleteConfirmId}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <button
          className="activity-sidebar-history-btn"
          type="button"
          title={`History drawer (${workspaceState.history.length} closed surface${workspaceState.history.length === 1 ? "" : "s"})`}
          onClick={onOpenHistory}
        >
          <Clock size={11} />
          <span>History</span>
          {workspaceState.history.length > 0 ? (
            <span className="activity-sidebar-history-badge">{workspaceState.history.length}</span>
          ) : null}
        </button>
      </div>

      <div className="sidebar-bottom-account">
        <AccountButton account={account} onOpenSettings={onOpenSettings} />
        <UpdateButton updates={updates} onOpenSettings={onOpenSettings} />
      </div>
      <StatusBar onClick={onOpenLogPanel} />

      <ConfirmDialog
        open={deleteConfirmId !== null}
        title="Delete from history"
        message={deleteTarget
          ? `Permanently delete "${surfaceDisplayTitle(deleteTarget)}" from history? The backing session or PTY is not deleted by this action.`
          : "Permanently delete this surface from history?"}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </aside>
  );
}
