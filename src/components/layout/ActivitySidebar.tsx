import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  EyeOff,
  FileText,
  GitBranch,
  FolderPlus,
  FlaskConical,
  LayoutTemplate,
  MessageSquare,
  MoreVertical,
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
import { useDropdownPosition } from "../../state/useDropdownPosition";
import { AccountButton } from "./AccountButton";
import { ConfirmDialog } from "./ConfirmDialog";
import { StatusBar } from "./StatusBar";
import { UpdateButton } from "./UpdateButton";
import { RepoIcon } from "./RepoIcon";
import { getRepoIdentity, type RepoIdentity } from "../../lib/repoIdentity";
import { humanizeChatTitle } from "../../lib/titles";
import { getWorkspaceRestoreState } from "../../lib/workspace";
import {
  flattenLeaves,
  migrateFromLegacyBlob,
  visibleSurfaceIds,
  type ClosedSurfaceRecord,
  type LeafNode,
  type SplitDirection,
  type SurfaceKind,
  type SurfaceRecord,
  type TreeNode,
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

// ── Tree depth helper ───────────────────────────────────────────────────────

/** Flatten visible leaves with their tree depth for neutral connector
 *  treatment. DFS order matches `flattenLeaves`. */
function flattenLeavesWithDepth(tree: TreeNode | null): { leaf: LeafNode; depth: number }[] {
  function walk(node: TreeNode | null, depth: number): { leaf: LeafNode; depth: number }[] {
    if (!node) return [];
    if (!("direction" in node)) return [{ leaf: node, depth }];
    return [...walk(node.first, depth + 1), ...walk(node.second, depth + 1)];
  }
  return walk(tree, 0);
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
  const [open, setOpen] = useState(false);
  const menuPos = useDropdownPosition(160);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuPos.triggerRef.current?.contains(target)) return;
      const menu = document.querySelector(".project-menu-dropdown");
      if (menu && !menu.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, menuPos.triggerRef]);

  if (!onOpenInExplorer && !onRemoveProject && !onCopyPath && !onNewChat && !onOpenFiles && !onOpenChanges && !onClearChats && !onTogglePin) return null;

  return (
    <div className="project-menu-wrap">
      <button
        ref={menuPos.triggerRef}
        className="project-menu-btn"
        type="button"
        title={`Manage ${projectName}`}
        onClick={(e) => { e.stopPropagation(); menuPos.recompute(); setOpen((v) => !v); }}
      >
        <MoreVertical size={12} />
      </button>
      {open ? (
        <div className={`project-menu-dropdown ${menuPos.placement === "top" ? "is-above" : ""}`} role="menu" aria-label={`Actions for ${projectName}`}>
          {onNewChat ? (
            <button className="project-menu-item" type="button" title="Start a new chat in this project" onClick={(e) => { e.stopPropagation(); setOpen(false); onNewChat(projectPath); }}>
              <Plus size={11} /> New Chat
            </button>
          ) : null}
          {onOpenFiles ? (
            <button className="project-menu-item" type="button" title="Browse files in this project" onClick={(e) => { e.stopPropagation(); setOpen(false); onOpenFiles(projectPath); }}>
              <FileText size={11} /> Files
            </button>
          ) : null}
          {onOpenChanges ? (
            <button className="project-menu-item" type="button" title="View git changes in this project" onClick={(e) => { e.stopPropagation(); setOpen(false); onOpenChanges(projectPath); }}>
              <GitBranch size={11} /> Changes
            </button>
          ) : null}
          {onCopyPath ? (
            <button className="project-menu-item" type="button" title="Copy the project folder path to the clipboard" onClick={(e) => { e.stopPropagation(); setOpen(false); onCopyPath(projectPath); }}>
              <Copy size={11} /> Copy project path
            </button>
          ) : null}
          {onOpenInExplorer ? (
            <button className="project-menu-item" type="button" title="Open this project folder in the file explorer" onClick={(e) => { e.stopPropagation(); setOpen(false); onOpenInExplorer(projectPath); }}>
              <FolderPlus size={11} /> Open in Explorer
            </button>
          ) : null}
          {onTogglePin ? (
            <button className="project-menu-item" type="button" title={isPinned ? "Unpin project from top of list" : "Pin project to top of list"} onClick={(e) => { e.stopPropagation(); setOpen(false); onTogglePin(projectPath); }}>
              <Pin size={11} /> {isPinned ? "Unpin" : "Pin"}
            </button>
          ) : null}
          {onClearChats ? (
            <button className="project-menu-item is-danger" type="button" title="Clear all chats for this project" onClick={(e) => { e.stopPropagation(); setOpen(false); onClearChats(projectPath); }}>
              <TerminalSquare size={11} /> Clear Chats
            </button>
          ) : null}
          {onRemoveProject ? (
            <button className="project-menu-item is-danger" type="button" title={`Remove ${projectName} from the sidebar (does not delete files)`} onClick={(e) => { e.stopPropagation(); setOpen(false); onRemoveProject(projectPath); }}>
              <Trash2 size={11} /> Remove Project
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Surface row actions (inline, revealed on hover/focus-within) ────────────

function SurfaceActionButtons({
  surfaceId,
  visible,
  onRemoveFromLayout,
  onClose,
}: {
  surfaceId: string;
  visible: boolean;
  onRemoveFromLayout: (surfaceId: string) => void;
  onClose: (surfaceId: string) => void;
}) {
  return (
    <span className="surface-row-actions" aria-hidden={false}>
      {visible ? (
        <button
          className="surface-row-action-btn"
          type="button"
          title="Remove from layout (hide without closing)"
          onClick={(e) => { e.stopPropagation(); onRemoveFromLayout(surfaceId); }}
        >
          <EyeOff size={11} />
        </button>
      ) : null}
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
    () => flattenLeavesWithDepth(workspaceState.visibleTree),
    [workspaceState.visibleTree],
  );
  const visibleIds = useMemo(
    () => visibleSurfaceIds(workspaceState.visibleTree),
    [workspaceState.visibleTree],
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
      .filter((s) => !visibleIds.has(s.id))
      .sort((a, b) => b.lastFocusedAt - a.lastFocusedAt);
  }, [activeSurfaceList, visibleIds]);

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
          <button className="btn-icon" type="button" title="New chat" onClick={onCreateChat} disabled={!activeProjectPath}>
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
        <button className="btn btn-ghost btn-sm" type="button" title="New chat" onClick={onCreateChat} disabled={!activeProjectPath}>
          <Plus size={12} /> New chat
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
            }).map((project) => {
              const isActive = project.path === activeProjectPath;
              const identity = repoIdentities.get(project.path);
              const name = identity?.name ?? project.name;
              const branch = identity?.branch ?? null;
              const host = identity?.host ?? "folder";
              const otherSurfaces = !isActive
                ? otherProjectSurfaces.get(project.path) ?? []
                : [];
              return (
                <div key={project.path} className={`activity-sidebar-project-row${isActive ? " is-active" : ""}${pinnedPaths.has(project.path) ? " is-pinned" : ""}`}>
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
                      {/* Visible surfaces in DFS tree order with neutral connector treatment */}
                      {visibleLeaves.map(({ leaf, depth }) => {
                        const surface = workspaceState.activeSurfaces[leaf.surfaceId];
                        if (!surface) return null;
                        const Icon = surfaceKindIcon[surface.kind];
                        const isFocused = surface.id === focusedSurfaceId;
                        const title = displayTitles.get(surface.id) ?? surfaceDisplayTitle(surface);
                        return (
                          <div
                            key={leaf.id}
                            className={`surface-row is-visible${isFocused ? " is-focused" : ""}`}
                            style={{ "--surface-depth": depth } as React.CSSProperties}
                            role="button"
                            tabIndex={0}
                            title={`${title} — ${surfaceKindLabel[surface.kind]} (visible${isFocused ? ", focused" : ""})`}
                            onClick={() => onFocusSurface(surface.id)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFocusSurface(surface.id); } }}
                          >
                            <span className="surface-row-connector" aria-hidden="true">{depth > 0 ? "╰─" : ""}</span>
                            <Icon size={11} className="surface-row-icon" />
                            <span className="surface-row-title">{title}</span>
                            <SurfaceActionButtons
                              surfaceId={surface.id}
                              visible={true}
                              onRemoveFromLayout={onRemoveSurfaceFromLayout}
                              onClose={onCloseSurface}
                            />
                          </div>
                        );
                      })}

                      {/* Hidden active surfaces as sibling rows (no visible marker) */}
                      {hiddenSurfaces.map((surface) => {
                        const Icon = surfaceKindIcon[surface.kind];
                        const title = displayTitles.get(surface.id) ?? surfaceDisplayTitle(surface);
                        return (
                          <div
                            key={surface.id}
                            className="surface-row is-hidden"
                            role="button"
                            tabIndex={0}
                            title={`${title} — ${surfaceKindLabel[surface.kind]} (hidden, click to replace focused surface)`}
                            onClick={() => onReplaceFocusedSurface(surface.id)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onReplaceFocusedSurface(surface.id); } }}
                          >
                            <Icon size={11} className="surface-row-icon" />
                            <span className="surface-row-title">{title}</span>
                            <SurfaceActionButtons
                              surfaceId={surface.id}
                              visible={false}
                              onRemoveFromLayout={onRemoveSurfaceFromLayout}
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
