import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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
  /** Drag handle props for reorder/split. */
  onDragStart: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragMove: (e: PointerEvent) => void;
  onDragCancel: () => void;
};

export function PanelHeader(props: PanelHeaderProps) {
  const { panel, status, isActive, onFocus, onClose, onSplitRight, onSplitDown, onDuplicate, onRename, onDragStart, onDragEnd, onDragMove, onDragCancel } = props;
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

  return (
    <div
      className={`panel-header${isActive ? " is-active" : ""}`}
      onPointerDown={startDrag}
      onClick={onFocus}
      data-panel-id={panel.id}
      data-panel-status={status}
    >
      <div className="panel-header-drag-handle" ref={dragHandleRef} data-panel-header-drag-handle="true">
        <Icon size={11} className="panel-header-icon" />
        {editing ? (
          <input
            className="input panel-header-title-input"
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setEditValue(panel.title); setEditing(false); }
            }}
            title="Rename panel (Enter to save, Esc to cancel)"
            autoFocus
          />
        ) : (
          <span
            className="panel-header-title"
            title={panel.title}
            onDoubleClick={(e) => { e.stopPropagation(); setEditValue(panel.title); setEditing(true); }}
          >
            {panel.title}
          </span>
        )}
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
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title="Close panel (session retained in history)"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
          <X size={11} />
        </button>
      </div>
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
  );
}
