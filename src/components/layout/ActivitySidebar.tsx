import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  FolderPlus,
  LayoutList,
  LayoutTemplate,
  Loader2,
  MessageSquare,
  Plus,
  Settings2,
  TerminalSquare,
  MoreVertical,
  Trash2,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { flattenPanels, parsePanelGrid } from "../../lib/panelGrid";
import { useDropdownPosition } from "../../state/useDropdownPosition";
import { usePanelStatus, type PanelStatus } from "../panels/PanelStatusContext";
import { AccountButton } from "./AccountButton";
import { UpdateButton } from "./UpdateButton";
import { RepoIcon } from "./RepoIcon";
import { getRepoIdentity, type RepoHost, type RepoIdentity } from "../../lib/repoIdentity";
import { getProjectAgentStatus, type AgentStatus } from "../../lib/agentStatus";
import { nativeChatList, type NativeChatSession } from "../../lib/native-chat";
import { getWorkspaceRestoreState } from "../../lib/workspace";
import { formatRelativeTime } from "../../lib/timing";
import type { AccountState } from "../../state/account";
import type { UpdaterState } from "../../state/updater";
import type { Panel, PanelType, SplitNode } from "../../lib/panelGrid";
import type { RecentProject } from "../../lib/projects";

const typeIcons: Record<PanelType, LucideIcon> = {
  chat: MessageSquare,
  terminal: TerminalSquare,
  file: FileText,
  schematic: LayoutTemplate,
  omp: Zap,
};

const statusDotClass: Record<PanelStatus, string> = {
  idle: "panel-status-idle",
  streaming: "panel-status-streaming",
  thinking: "panel-status-thinking",
  running: "panel-status-running",
  asking: "panel-status-asking",
  error: "panel-status-error",
  succeeded: "panel-status-succeeded",
};

const activeStatusWords: Record<PanelStatus, boolean> = {
  idle: false,
  streaming: true,
  thinking: true,
  running: true,
  asking: true,
  error: false,
  succeeded: false,
};

const statusWordLabel: Record<PanelStatus, string> = {
  idle: "idle",
  streaming: "streaming",
  thinking: "thinking",
  running: "running",
  asking: "asking",
  error: "error",
  succeeded: "done",
};

export type ActivitySidebarProps = {
  activeProjectPath: string | null;
  root: SplitNode | null;
  activePanelId: string | null;
  closedPanelCount: number;
  projects: RecentProject[];
  account: AccountState;
  updates: UpdaterState;
  onSelectProject: (path: string) => void;
  onOpenFolder: () => void;
  onRemoveProject?: (path: string) => void;
  onOpenInExplorer?: (path: string) => void;
  pickerInFlight: boolean;
  onFocusPanel: (panelId: string) => void;
  onCreateChat: () => void;
  onOpenHistory: () => void;
  onOpenPlans: () => void;
  onOpenSettings: () => void;
  onCreateTerminal: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

function ProjectMenuButton({ projectPath, projectName, onOpenInExplorer, onRemoveProject }: {
  projectPath: string;
  projectName: string;
  onOpenInExplorer?: (path: string) => void;
  onRemoveProject?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuPos = useDropdownPosition(160);
  const closeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuPos.triggerRef.current?.contains(target)) return;
      const menu = document.querySelector(".project-menu-dropdown");
      if (menu && !menu.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    closeRef.current = () => document.removeEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, menuPos.triggerRef]);

  if (!onOpenInExplorer && !onRemoveProject) return null;

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
          {onOpenInExplorer ? (
            <button
              className="project-menu-item"
              type="button"
              title="Open this project folder in the file explorer"
              onClick={(e) => { e.stopPropagation(); setOpen(false); onOpenInExplorer(projectPath); }}
            >
              <FolderPlus size={11} /> Open in Explorer
            </button>
          ) : null}
          {onRemoveProject ? (
            <button
              className="project-menu-item is-danger"
              type="button"
              title={`Remove ${projectName} from the sidebar (does not delete files)`}
              onClick={(e) => { e.stopPropagation(); setOpen(false); onRemoveProject(projectPath); }}
            >
              <Trash2 size={11} /> Remove Project
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ActivitySidebar({
  activeProjectPath,
  root,
  activePanelId,
  closedPanelCount,
  projects,
  account,
  updates,
  onSelectProject,
  onOpenFolder,
  onRemoveProject,
  onOpenInExplorer,
  pickerInFlight,
  onFocusPanel,
  onCreateChat,
  onCreateTerminal,
  onOpenHistory,
  onOpenPlans,
  onOpenSettings,
  collapsed,
  onToggleCollapse,
}: ActivitySidebarProps) {
  const [repoIdentities, setRepoIdentities] = useState<Map<string, RepoIdentity>>(new Map());
  const [otherProjectChats, setOtherProjectChats] = useState<Map<string, NativeChatSession[]>>(new Map());
  const [, setClock] = useState(0);

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

  // Fetch chats OPEN in each non-active project's saved workspace grid —
  // never the full session history. Mirrors what the active project shows
  // (its open panels), just unloaded. Polls every 5s so run state stays
  // live while chats in other projects continue running in the background.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function fetchOtherChats() {
      const otherProjects = projects.filter((p) => p.path !== activeProjectPath);
      if (otherProjects.length === 0) {
        setOtherProjectChats(new Map());
        return;
      }
      const entries = await Promise.all(
        otherProjects.map(async (p) => {
          try {
            const [restore, sessions] = await Promise.all([
              getWorkspaceRestoreState(p.path),
              nativeChatList(p.path),
            ]);
            const grid = parsePanelGrid(restore.panelGrid);
            const openChatIds = new Set(
              flattenPanels(grid.root)
                .filter((panel) => panel.type === "chat" && panel.chatSessionId)
                .map((panel) => panel.chatSessionId as string),
            );
            return [p.path, sessions.filter((s) => openChatIds.has(s.id))] as [string, NativeChatSession[]];
          } catch {
            return [p.path, []] as [string, NativeChatSession[]];
          }
        }),
      );
      if (cancelled) return;
      const map = new Map<string, NativeChatSession[]>();
      for (const [path, sessions] of entries) {
        map.set(path, sessions);
      }
      setOtherProjectChats(map);
    }
    void fetchOtherChats();
    timer = window.setInterval(() => void fetchOtherChats(), 5000);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [projects, activeProjectPath]);

  // Tick a clock every 15s so relative times refresh.
  useEffect(() => {
    const id = window.setInterval(() => setClock((c) => c + 1), 15000);
    return () => window.clearInterval(id);
  }, []);

  const { statuses } = usePanelStatus();
  const panels = useMemo(() => flattenPanels(root), [root]);

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
          <button className="btn-icon" type="button" title="Plans & Ideas" aria-label="Plans & Ideas" onClick={onOpenPlans} disabled={!activeProjectPath}>
            <LayoutList size={14} />
          </button>
          <button className="btn-icon" type="button" title={pickerInFlight ? "Opening folder picker…" : "Add project folder"} onClick={onOpenFolder} disabled={pickerInFlight}>
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

  const activeIdentity = activeProjectPath ? repoIdentities.get(activeProjectPath) : undefined;
  const activeName = activeIdentity?.name ?? projects.find((p) => p.path === activeProjectPath)?.name ?? activeProjectPath?.split(/[\\/]/).pop() ?? "Project";
  const activeBranch = activeIdentity?.branch ?? null;
  const activeHost = activeIdentity?.host ?? "folder";
  const activeAgentStatus = getProjectAgentStatus(panels.map((p) => statuses[p.id]?.status ?? "idle"));
  function renderPanelMeta(panelId: string) {
    const entry = statuses[panelId];
    const status = entry?.status ?? "idle";
    const since = entry?.since;
    if (activeStatusWords[status]) {
      return (
        <span className="activity-sidebar-row-meta" title={`Status: ${statusWordLabel[status]}`}>
          {statusWordLabel[status]}
          <Loader2 size={9} className="is-spinning" />
        </span>
      );
    }
    if (since) {
      return (
        <span className="activity-sidebar-row-meta" title={new Date(since).toLocaleString()}>
          {formatRelativeTime(since)}
        </span>
      );
    }
    return null;
  }

  return (
    <aside className="project-chat-sidebar" aria-label="Activity sidebar">
      <div className="sidebar-top-actions">
        <button className="btn btn-ghost btn-sm" type="button" title="New chat" onClick={onCreateChat} disabled={!activeProjectPath}>
          <Plus size={12} /> New chat
        </button>
        <button className="btn-icon" type="button" title="New terminal" onClick={onCreateTerminal} disabled={!activeProjectPath}>
          <TerminalSquare size={14} />
        </button>
        <button className="btn-icon" type="button" title="Plans & Ideas" aria-label="Plans & Ideas" onClick={onOpenPlans} disabled={!activeProjectPath}>
          <LayoutList size={14} />
        </button>
        <button className="btn-icon" type="button" title={pickerInFlight ? "Opening folder picker…" : "Add project folder"} onClick={onOpenFolder} disabled={pickerInFlight}>
          <FolderPlus size={14} />
        </button>
        <button className="btn-icon" type="button" title="Collapse sidebar" onClick={onToggleCollapse}>
          <ChevronLeft size={14} />
        </button>
      </div>

      <div className="activity-sidebar">
        <div className="activity-sidebar-list">
          {/* All projects in alphabetical order - active project stays in place */}
          {projects.length === 0 ? (
            <div className="sidebar-empty text-muted text-sm">
              No projects yet. <button className="chat-link-btn" type="button" title="Add a project folder" onClick={onOpenFolder}>Add a folder</button>.
            </div>
          ) : (
            projects.map((project) => {
              const isActive = project.path === activeProjectPath;
              const identity = repoIdentities.get(project.path);
              const name = identity?.name ?? project.name;
              const branch = identity?.branch ?? null;
              const host = identity?.host ?? "folder";
              const agentStatus = isActive
                ? activeAgentStatus
                : "idle";
              const chats = !isActive
                ? otherProjectChats.get(project.path) ?? []
                : [];
              return (
                <div key={project.path} className={`activity-sidebar-project-row${isActive ? " is-active" : ""}`}>
                  <div
                    className="activity-sidebar-project-main"
                    title={project.path}
                    onClick={() => onSelectProject(project.path)}
                  >
                    <RepoIcon host={host} size={isActive ? 14 : 11} />
                    <span className={isActive ? "activity-sidebar-project-name" : "activity-sidebar-row-title"}>{name}</span>
                    <span className={`agent-status-dot agent-status-${agentStatus}`} title={`Agent: ${agentStatus}`} aria-label={`Agent status: ${agentStatus}`} />
                  </div>
                  <ProjectMenuButton
                    projectPath={project.path}
                    projectName={name}
                    onOpenInExplorer={onOpenInExplorer}
                    onRemoveProject={onRemoveProject}
                  />
                  {branch ? (
                    <span className="activity-sidebar-project-branch" title={`Branch: ${branch}`} onClick={() => onSelectProject(project.path)}>
                      {branch}
                    </span>
                  ) : null}
                  {/* Active project: show open panels (chats) underneath */}
                  {isActive && panels.length > 0 ? (
                    panels.map((panel) => {
                      const Icon = typeIcons[panel.type] ?? FileText;
                      const isPanelActive = panel.id === activePanelId;
                      return (
                        <div
                          key={panel.id}
                          className={`activity-sidebar-row${isPanelActive ? " is-active" : ""}`}
                          title={panel.title}
                          onClick={() => onFocusPanel(panel.id)}
                        >
                          <Icon size={11} className="activity-sidebar-row-icon" />
                          <span className="activity-sidebar-row-title">{panel.title}</span>
                          {renderPanelMeta(panel.id)}
                          <span className={`activity-sidebar-row-status panel-status-indicator ${statusDotClass[statuses[panel.id]?.status ?? "idle"]}`} />
                        </div>
                      );
                    })
                  ) : null}
                  {/* Active project with no panels: show empty state */}
                  {isActive && panels.length === 0 ? (
                    <div className="sidebar-empty text-muted text-sm">
                      No panels open. <button className="chat-link-btn" type="button" title="Start a new chat" onClick={onCreateChat}>Start a chat</button>.
                    </div>
                  ) : null}
                  {/* Inactive project: show its open chats from saved workspace */}
                  {!isActive && chats.length > 0 ? (
                    <div className="activity-sidebar-project-chats" aria-label={`${name} chats`}>
                      {chats.map((session) => {
                        const fullTs = new Date(session.updatedAt * 1000).toLocaleString();
                        return (
                          <div
                            key={session.id}
                            className="activity-sidebar-project-chat"
                            title={`${session.title} - ${fullTs}`}
                            onClick={() => onSelectProject(project.path)}
                          >
                            <MessageSquare size={10} className="activity-sidebar-row-icon" />
                            <span className="activity-sidebar-project-chat-title">{session.title}</span>
                            {session.runState === "running" ? (
                              <span className="activity-sidebar-project-chat-running" title="Chat is running" />
                            ) : null}
                            <span className="activity-sidebar-project-chat-time">{formatRelativeTime(session.updatedAt)}</span>
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
        <button
          className="activity-sidebar-history-btn"
          type="button"
          title={`History (${closedPanelCount} closed panels)`}
          onClick={onOpenHistory}
        >
          <Clock size={11} />
          <span>History</span>
          {closedPanelCount > 0 ? (
            <span className="activity-sidebar-history-badge">{closedPanelCount}</span>
          ) : null}
        </button>
      </div>

      <div className="sidebar-bottom-account">
        <AccountButton account={account} onOpenSettings={onOpenSettings} />
        <UpdateButton updates={updates} onOpenSettings={onOpenSettings} />
      </div>
    </aside>
  );
}
