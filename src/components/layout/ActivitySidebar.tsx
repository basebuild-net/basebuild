import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
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
  type ClosedSurfaceRecord,
  type SplitDirection,
  type SurfaceKind,
  type SurfaceRecord,
  type WorkspaceState,
} from "../../lib/workspaceState";
import { parsePanelGrid } from "../../lib/panelGrid";
import { panelGridToWorkspaceState } from "../../lib/workspaceBridge";
import { buildSidebarUnits } from "../../lib/sidebarLayout";
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
 *  appending a 1-based index. Both the sidebar and panel header use this
 *  so titles stay in sync. */
export function buildDisplayTitles(surfaces: SurfaceRecord[]): Map<string, string> {
  // Sort by createdAt then id so the "(N)" index is stable — it does not
  // swap when panels move between visible/hidden/stashed, which would
  // make clicking "New Chat (2)" actually focus "New Chat (1)".
  const sorted = [...surfaces].sort((a, b) =>
    a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const display = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const s of sorted) {
    const base = surfaceDisplayTitle(s);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  for (const s of sorted) {
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

/** Derive a stable colour for a project's linked group. Groups within one
 *  project are spread apart on the hue wheel by `groupIndex` (golden-angle
 *  step) so sibling groups read as clearly different colours. */
function groupColorFromPath(path: string, groupIndex = 0): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0;
  }
  const hue = (Math.abs(hash) + groupIndex * 137) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

type SurfaceVisibility = "visible" | "stashed" | "hidden";

/** A short status subtitle for a surface, shown below the title. */
function surfaceStatusText(
  surface: SurfaceRecord,
  visibility: SurfaceVisibility,
  isGrouped: boolean,
  isFocused: boolean,
): string {
  if (visibility === "stashed") return "stashed";
  if (isFocused) return "active";
  if (isGrouped) return "linked";
  const ageSec = Math.floor((Date.now() - surface.createdAt) / 1000);
  if (ageSec < 30) return "new";
  return "standby";
}



// ── Props ───────────────────────────────────────────────────────────────────

export type ActivitySidebarProps = {
  activeProjectPath: string | null;
  /** The active project's workspace state (active registry + visible tree +
   *  history). The sidebar renders surfaces from this, not from legacy tabs. */
  workspaceState: WorkspaceState;
  /** Disambiguated display titles (surface id → title with optional "(N)").
   *  Computed by the parent so sidebar and panel headers stay in sync. */
  displayTitles?: Map<string, string>;
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

// ── Surface row (shared by the active project and inactive project rows) ─────

function SurfaceRow({
  surface,
  title,
  time,
  statusText,
  visibility,
  isFocused,
  isGrouped,
  groupColor,
  onActivate,
  draggable = false,
  onDropOnto,
  onClose,
  otherProject = false,
}: {
  surface: SurfaceRecord;
  title: string;
  time: string;
  statusText: string;
  visibility: SurfaceVisibility;
  isFocused: boolean;
  isGrouped: boolean;
  groupColor: string | null;
  onActivate: () => void;
  draggable?: boolean;
  onDropOnto?: (sourceId: string) => void;
  onClose?: (surfaceId: string) => void;
  otherProject?: boolean;
}) {
  return (
    <div
      className={`surface-row is-${visibility}${isFocused ? " is-focused" : ""}${otherProject ? " is-other-project" : ""}`}
      role="button"
      tabIndex={0}
      draggable={draggable}
      data-surface-id={surface.id}
      data-surface-visibility={visibility}
      style={groupColor ? ({ "--group-color": groupColor } as React.CSSProperties) : undefined}
      title={`${title} — ${statusText}${isFocused ? ", focused" : ""} · ${time}`}
      onClick={onActivate}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(); } }}
      onDragStart={draggable ? (event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-basebuild-surface", surface.id);
        event.dataTransfer.setData("text/plain", surface.id);
        document.body.dataset.surfaceDragging = "true";
      } : undefined}
      onDragEnd={draggable ? () => { delete document.body.dataset.surfaceDragging; } : undefined}
      onDragOver={onDropOnto ? (event) => { if (event.dataTransfer.types.includes("text/plain")) event.preventDefault(); } : undefined}
      onDrop={onDropOnto ? (event) => {
        event.preventDefault();
        event.stopPropagation();
        const sourceId = event.dataTransfer.getData("text/plain") || event.dataTransfer.getData("application/x-basebuild-surface");
        if (sourceId && sourceId !== surface.id) onDropOnto(sourceId);
      } : undefined}
    >
      {isGrouped ? <span className="surface-row-group-mark" aria-hidden="true" /> : null}
      <div className="surface-row-body">
        <div className="surface-row-main">
          <span className="surface-row-title">{title}</span>
          <span className="surface-row-time">{time}</span>
        </div>
        <span className="surface-row-subtitle">{statusText}</span>
      </div>
      {onClose ? <SurfaceActionButtons surfaceId={surface.id} onClose={onClose} /> : null}
    </div>
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
  displayTitles: displayTitlesProp,
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

  // Snapshot each non-active project's full workspace (from its saved blob) so
  // the sidebar renders the SAME grouped, timestamped, status-labelled view for
  // every project — no need to focus a project to see its chats. Polls every 5s
  // and merges results so a transient read failure never blanks a project.
  const [otherProjectWorkspaces, setOtherProjectWorkspaces] = useState<Map<string, WorkspaceState>>(new Map());
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function fetchOtherWorkspaces() {
      const otherProjects = projects.filter((p) => p.path !== activeProjectPath);
      const entries = await Promise.all(
        otherProjects.map(async (p): Promise<[string, WorkspaceState | null]> => {
          try {
            const restore = await getWorkspaceRestoreState(p.path);
            const parsed = parsePanelGrid(restore.panelGrid ?? null);
            return [p.path, panelGridToWorkspaceState(parsed, p.path)];
          } catch {
            return [p.path, null];
          }
        }),
      );
      if (cancelled) return;
      setOtherProjectWorkspaces((prev) => {
        const next = new Map<string, WorkspaceState>();
        for (const [path, ws] of entries) {
          const resolved = ws ?? prev.get(path);
          if (resolved) next.set(path, resolved);
        }
        return next;
      });
    }
    void fetchOtherWorkspaces();
    timer = window.setInterval(() => void fetchOtherWorkspaces(), 5000);
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

  // ── Derive per-project surface data ──────────────────────────────────────
  // The active project reads live workspace state; inactive projects read their
  // saved snapshot. Both feed buildSidebarUnits so the view is identical.

  const activeSurfaceList = useMemo(
    () => Object.values(workspaceState.activeSurfaces),
    [workspaceState.activeSurfaces],
  );

  const displayTitles = useMemo(() => {
    if (displayTitlesProp) return displayTitlesProp;
    const historySurfaces = workspaceState.history.map((h) => h as SurfaceRecord);
    return buildDisplayTitles([...activeSurfaceList, ...historySurfaces]);
  }, [displayTitlesProp, activeSurfaceList, workspaceState.history]);

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
              const projectWorkspace = isActive
                ? workspaceState
                : otherProjectWorkspaces.get(project.path) ?? null;
              const units = projectWorkspace ? buildSidebarUnits(projectWorkspace) : [];
              const projectFocusedId = projectWorkspace?.focusedSurfaceId ?? null;
              const projectTitles = isActive
                ? displayTitles
                : buildDisplayTitles(projectWorkspace ? Object.values(projectWorkspace.activeSurfaces) : []);
              return (
                <div
                  key={project.path}
                  className={`activity-sidebar-project-row${isActive ? " is-active" : ""}${pinnedPaths.has(project.path) ? " is-pinned" : ""}`}
                >
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
                    {isActive ? (
                      <button
                        className="project-add-chat-btn"
                        type="button"
                        title="Add a new unlinked chat"
                        onClick={(e) => { e.stopPropagation(); onNewChat?.(project.path); }}
                      >
                        <Plus size={11} />
                      </button>
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

                  {/* Surfaces — grouped and recency-ordered; identical view for
                      the active project and every inactive project. */}
                  {units.map((unit) => {
                    const isActiveGroup = isActive && unit.isVisible && unit.kind === "group";
                    return (
                      <div
                        key={`unit-${unit.surfaces[0].id}`}
                        className={`surface-unit${isActiveGroup ? " is-active-group" : ""}`}
                      >
                        {unit.surfaces.map((surface) => {
                          const isFocused = isActive && unit.isVisible && surface.id === projectFocusedId;
                          const isGrouped = unit.kind === "group";
                          const visibility: SurfaceVisibility = unit.isVisible ? "visible" : isGrouped ? "stashed" : "hidden";
                          const groupColor = unit.colorIndex >= 0 ? groupColorFromPath(project.path, unit.colorIndex) : null;
                          const title = projectTitles.get(surface.id) ?? surfaceDisplayTitle(surface);
                          const statusText = surfaceStatusText(surface, visibility, isGrouped, isFocused);
                          const time = formatRelativeTime(surface.lastFocusedAt);
                          return (
                            <SurfaceRow
                              key={surface.id}
                              surface={surface}
                              title={title}
                              time={time}
                              statusText={statusText}
                              visibility={visibility}
                              isFocused={isFocused}
                              isGrouped={isGrouped}
                              groupColor={groupColor}
                              onActivate={isActive
                                ? () => (unit.isVisible ? onFocusSurface(surface.id) : onReplaceFocusedSurface(surface.id))
                                : () => onSelectProject(project.path)}
                              draggable={isActive}
                              onDropOnto={isActive ? (sourceId) => onGroupSurface(sourceId, surface.id, "right") : undefined}
                              onClose={isActive ? onCloseSurface : undefined}
                              otherProject={!isActive}
                            />
                          );
                        })}
                        {isActive && unit.isVisible ? (
                          <button
                            className="surface-add-linked-btn"
                            type="button"
                            title="Add a new chat linked to this group"
                            onClick={(e) => { e.stopPropagation(); onAddLinkedChat(); }}
                          >
                            <Plus size={10} />
                            <span>Add linked chat</span>
                          </button>
                        ) : null}
                      </div>
                    );
                  })}

                  {/* Unlink dropzone — active project only, when a layout exists. */}
                  {isActive && units.some((u) => u.isVisible) ? (
                    <div
                      className="surface-unlink-dropzone"
                      data-surface-unlink-dropzone
                      title="Drop a linked chat here to make it a separate active chat"
                      onDragOver={(event) => { if (event.dataTransfer.types.includes("text/plain")) event.preventDefault(); }}
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

                  {/* Empty state — active project only. */}
                  {isActive && units.length === 0 ? (
                    <div className="sidebar-empty text-muted text-sm">
                      No active surfaces. <button className="chat-link-btn" type="button" title="Start a new chat" onClick={onCreateChat}>Start a chat</button>.
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
