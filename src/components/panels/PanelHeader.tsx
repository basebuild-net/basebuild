import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  FileText,
  GripVertical,
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
  /** Switch to a tab within this panel (multi-tab only). */
  onSwitchTab?: (tabId: string) => void;
  /** Close a specific tab within this panel (multi-tab only). */
  onCloseTab?: (tabId: string) => void;
  /** Drag handle props for reorder/split. */
  onDragStart: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragMove: (e: PointerEvent) => void;
  onDragCancel: () => void;
};

export function PanelHeader(props: PanelHeaderProps) {
  const { panel, status, isActive, onFocus, onClose, onSplitRight, onSplitDown, onDuplicate, onRename, onSwitchTab, onCloseTab, onDragStart, onDragEnd, onDragMove, onDragCancel } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(panel.title);
  const dragHandleRef = useRef<HTMLDivElement>(null);

  const Icon = typeIcons[panel.type] ?? FileText;
  const statusClass = `panel-status-${status}`;

  const commitRename = () => {
    if (editValue.trim()) onRename(editValue.trim());
    setEditing(false);
  };

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Don't start drag from buttons or the input.
    const target = e.target;
    if (target instanceof Element && target.closest("button, input")) return;
    onDragStart(e);
  };

  const hasTabs = panel.tabs && panel.tabs.length > 1;
  const activeTabData = panel.tabs && panel.tabs.length > 0
    ? panel.tabs.find((t) => t.id === panel.activeTabId) ?? panel.tabs[0]
    : null;
  const displayTitle = activeTabData?.title ?? panel.title;
  const displayType = activeTabData?.type ?? panel.type;
  const DisplayIcon = typeIcons[displayType] ?? FileText;

  return (
    <div
      className={`panel-header${isActive ? " is-active" : ""}`}
      onPointerDown={startDrag}
      onClick={onFocus}
      data-panel-id={panel.id}
      data-panel-status={status}
    >
      <div className="panel-header-drag-handle" ref={dragHandleRef} data-panel-header-drag-handle="true">
        <GripVertical size={11} className="panel-header-grip" />
        <DisplayIcon size={11} className="panel-header-icon" />
        {editing ? (
          <input
            className="input panel-header-title-input"
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setEditValue(displayTitle); setEditing(false); }
            }}
            title="Rename panel (Enter to save, Esc to cancel)"
            autoFocus
          />
        ) : (
          <span
            className="panel-header-title"
            title={displayTitle}
            onDoubleClick={(e) => { e.stopPropagation(); setEditValue(displayTitle); setEditing(true); }}
          >
            {displayTitle}
          </span>
        )}
        <span className={`panel-status-indicator ${statusClass}`} title={`Status: ${status}`} />
      </div>
      {hasTabs ? (
        <div className="panel-header-tabs">
          {panel.tabs!.map((tab) => {
            const TabIcon = typeIcons[tab.type] ?? FileText;
            const isActiveTab = tab.id === panel.activeTabId;
            return (
              <div
                key={tab.id}
                className={`panel-header-tab${isActiveTab ? " is-active" : ""}`}
                title={tab.title}
                onClick={(e) => { e.stopPropagation(); onSwitchTab?.(tab.id); }}
              >
                <TabIcon size={9} className="panel-header-tab-icon" />
                <span className="panel-header-tab-title">{tab.title}</span>
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
        </div>
      ) : null}
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
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title="Close panel (session retained in history)"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
          <X size={11} />
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
