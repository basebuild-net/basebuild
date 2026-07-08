import { useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  FolderPlus,
  LayoutList,
  LayoutTemplate,
  MessageSquare,
  Plus,
  Settings2,
  TerminalSquare,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { flattenPanels } from "../../lib/panelGrid";
import { usePanelStatus, type PanelStatus } from "../panels/PanelStatusContext";
import { AccountButton } from "./AccountButton";
import { UpdateButton } from "./UpdateButton";
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
  error: "panel-status-error",
  succeeded: "panel-status-succeeded",
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
          <button className="btn-icon" type="button" title="Plans & Ideas" onClick={onOpenPlans} disabled={!activeProjectPath}>
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

  return (
    <aside className="project-chat-sidebar" aria-label="Activity sidebar">
      <div className="sidebar-top-actions">
        <button className="btn btn-ghost btn-sm" type="button" title="New chat" onClick={onCreateChat} disabled={!activeProjectPath}>
          <Plus size={12} /> New chat
        </button>
        <button className="btn-icon" type="button" title="New terminal" onClick={onCreateTerminal} disabled={!activeProjectPath}>
          <TerminalSquare size={14} />
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
          {/* Active project as parent header */}
          {activeProjectPath ? (
            <div className="activity-sidebar-project">
              <span className="activity-sidebar-project-name" title={activeProjectPath}>
                {projects.find((p) => p.path === activeProjectPath)?.name ?? activeProjectPath.split(/[\\/]/).pop() ?? "Project"}
              </span>
            </div>
          ) : null}
          {/* Panels (chats) nested under the project */}
          {panels.length === 0 ? (
            <div className="sidebar-empty text-muted text-sm">
              No panels open. <button className="chat-link-btn" type="button" title="Start a new chat" onClick={onCreateChat}>Start a chat</button>.
            </div>
          ) : (
            panels.map((panel) => {
              const Icon = typeIcons[panel.type] ?? FileText;
              const isActive = panel.id === activePanelId;
              const status = statuses[panel.id]?.status ?? "idle";
              return (
                <div
                  key={panel.id}
                  className={`activity-sidebar-row${isActive ? " is-active" : ""}`}
                  title={panel.title}
                  onClick={() => onFocusPanel(panel.id)}
                >
                  <Icon size={11} className="activity-sidebar-row-icon" />
                  <span className="activity-sidebar-row-title">{panel.title}</span>
                  <span className={`activity-sidebar-row-status panel-status-indicator ${statusDotClass[status]}`} />
                </div>
              );
            })
          )}
          {/* Other projects below the panel list */}
          {projects.filter((p) => p.path !== activeProjectPath).length > 0 ? (
            <div className="activity-sidebar-other-projects">
              {projects.filter((p) => p.path !== activeProjectPath).map((project) => (
                <div
                  key={project.path}
                  className="activity-sidebar-project-row"
                  title={project.path}
                  onClick={() => onSelectProject(project.path)}
                >
                  <FolderPlus size={11} className="activity-sidebar-row-icon" />
                  <span className="activity-sidebar-row-title">{project.name}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <button
          className="activity-sidebar-history-btn"
          type="button"
          title="Plans & Ideas"
          onClick={onOpenPlans}
          disabled={!activeProjectPath}
        >
          <LayoutList size={11} />
          <span>Plans & Ideas</span>
        </button>
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
