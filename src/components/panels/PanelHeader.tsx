import { useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  FileText,
  MessageSquare,
  MoreVertical,
  PanelRightClose,
  SplitSquareHorizontal,
  SplitSquareVertical,
  TerminalSquare,
  Zap,
  LayoutTemplate,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Panel, PanelType } from "../../lib/panelGrid";
import type { PanelStatus } from "./PanelStatusContext";

const typeIcons: Record<PanelType, LucideIcon> = {
  chat: MessageSquare,
  terminal: TerminalSquare,
  file: FileText,
  schematic: LayoutTemplate,
  omp: Zap,
};

export type PanelHeaderProps = {
  panel: Panel;
  status: PanelStatus;
  isActive: boolean;
  onFocus: () => void;
  onClose: () => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  onDuplicate: () => void;
  onRename: (title: string) => void;
  /** Switch to a tab within this panel. */
  onSwitchTab?: (tabId: string) => void;
  /** Close a specific tab within this panel. */
  onCloseTab?: (tabId: string) => void;
  /**
   * Start a panel-level drag (reorder / split / merge). Called when the user
   * drags from a tab or the empty area of the tab strip.
   */
  onDragStart: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragMove: () => void;
  onDragCancel: () => void;
};

export function PanelHeader(props: PanelHeaderProps) {
  const { panel, status, isActive, onFocus, onClose, onSplitRight, onSplitDown, onDuplicate, onRename, onSwitchTab, onCloseTab, onDragStart, onDragEnd, onDragMove, onDragCancel } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(panel.title);
  void onDragEnd; void onDragMove; void onDragCancel;

  const statusClass = `panel-status-${status}`;

  const commitRename = () => {
    if (editValue.trim()) onRename(editValue.trim());
    setEditing(false);
  };

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Don't start drag from buttons, inputs, or close buttons.
    const target = e.target;
    if (target instanceof Element && target.closest("button, input")) return;
    onDragStart(e);
  };

  // Always show the tab strip — even with one tab. The tabs are the drag
  // handle (reorder / split / merge). No separate left-side label.
  const tabs = panel.tabs ?? [{
    id: panel.id,
    type: panel.type,
    title: panel.title,
    chatSessionId: panel.chatSessionId,
    terminalId: panel.terminalId,
    filePath: panel.filePath,
  }];
  const activeTabId = panel.activeTabId ?? tabs[0].id;

  return (
    <div
      className={`panel-header${isActive ? " is-active" : ""}`}
      onPointerDown={startDrag}
      onClick={onFocus}
      data-panel-id={panel.id}
      data-panel-status={status}
    >
      <div className="panel-header-tabs">
        {tabs.map((tab) => {
          const TabIcon = typeIcons[tab.type] ?? FileText;
          const isActiveTab = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`panel-header-tab${isActiveTab ? " is-active" : ""}`}
              title={tab.title}
              onClick={(e) => { e.stopPropagation(); onSwitchTab?.(tab.id); }}
            >
              <TabIcon size={9} className="panel-header-tab-icon" />
              {editing && isActiveTab ? (
                <input
                  className="input panel-header-tab-title-input"
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") { setEditValue(tab.title); setEditing(false); }
                  }}
                  title="Rename tab (Enter to save, Esc to cancel)"
                  autoFocus
                />
              ) : (
                <span
                  className="panel-header-tab-title"
                  onDoubleClick={(e) => { e.stopPropagation(); setEditValue(tab.title); setEditing(true); }}
                >
                  {tab.title}
                </span>
              )}
              <button
                className="panel-header-tab-close"
                type="button"
                title="Close tab"
                onClick={(e) => { e.stopPropagation(); onCloseTab?.(tab.id); }}
              >
                <X size={8} />
              </button>
            </div>
          );
        })}
        <span className={`panel-status-indicator ${statusClass}`} title={`Status: ${status}`} />
      </div>
      <div className="panel-header-actions">
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title="Split right"
          onClick={(e) => { e.stopPropagation(); onSplitRight(); }}
        >
          <SplitSquareHorizontal size={11} />
        </button>
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title="Split down"
          onClick={(e) => { e.stopPropagation(); onSplitDown(); }}
        >
          <SplitSquareVertical size={11} />
        </button>
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title="More actions"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
        >
          <MoreVertical size={11} />
        </button>
        {menuOpen ? (
          <div className="panel-header-menu" onMouseLeave={() => setMenuOpen(false)}>
            <button type="button" title="Duplicate this panel's settings" onClick={() => { setMenuOpen(false); onDuplicate(); }}>
              <PanelRightClose size={11} /> Duplicate
            </button>
            <button type="button" title="Split right (add panel beside)" onClick={() => { setMenuOpen(false); onSplitRight(); }}>
              <SplitSquareHorizontal size={11} /> Split right
            </button>
            <button type="button" title="Split down (add panel below)" onClick={() => { setMenuOpen(false); onSplitDown(); }}>
              <SplitSquareVertical size={11} /> Split down
            </button>
            <button type="button" title="Close and move to history" onClick={() => { setMenuOpen(false); onClose(); }}>
              <X size={11} /> Close
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
