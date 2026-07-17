import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  FileText,
  MessageSquare,
  MoreVertical,
  PanelRightClose,
  Plus,
  SplitSquareHorizontal,
  SplitSquareVertical,
  TerminalSquare,
  Zap,
  LayoutTemplate,
  X,
  Minus,
  Bot,
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
  onAddTab: () => void;
  onSplitDown: () => void;
  onDuplicate: () => void;
  onRename: (title: string) => void;
  /** Switch to a tab within this panel. */
  onSwitchTab?: (tabId: string) => void;
  /** Close a specific tab within this panel. */
  onCloseTab?: (tabId: string) => void;
  /** Reorder tabs within this panel's tab strip. */
  onReorderTabs?: (fromIndex: number, toIndex: number) => void;
  /**
   * Start a panel-level drag (reorder / split / merge). Called when the user
   * drags from a tab or the empty area of the tab strip.
   */
  onDragStart: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragMove: () => void;
  onDragCancel: () => void;
  /** When true, the panel hosts a background agent — show a minimize
   *  button instead of close, since closing would kill the agent's UI. */
  minimizable?: boolean;
  /** Chat session ids owned by an active background agent — their tabs get
   *  the bot icon + accent title and closing-keeps-running affordances. */
  backgroundChatIds?: Set<string>;
};
const TAB_DRAG_THRESHOLD = 4;

export function PanelHeader(props: PanelHeaderProps) {
  const { panel, status, isActive, onFocus, onClose, onSplitRight, onAddTab, onSplitDown, onDuplicate, onRename, onSwitchTab, onCloseTab, onReorderTabs, onDragStart, onDragEnd, onDragMove, onDragCancel, minimizable, backgroundChatIds } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(panel.title);
  const [tabDragOver, setTabDragOver] = useState<number | null>(null);
  void onDragEnd; void onDragMove; void onDragCancel;
  void status;

  const tabDragData = useRef<{ fromIndex: number; startX: number; pointerId: number } | null>(null);

  const commitRename = () => {
    if (editValue.trim()) onRename(editValue.trim());
    setEditing(false);
  };

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Don't start drag from buttons or inputs.
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

  // ── Tab reordering within the strip ──
  // Pointer-down on a tab starts tracking. If the pointer moves beyond the
  // threshold horizontally, we begin a tab reorder drag (swapping tabs within
  // the strip). If the pointer leaves the tab strip, we hand off to the
  // panel-level drag (split / merge / cross-panel reorder).
  const onTabPointerDown = (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    if (e.button !== 0) return;
    const target = e.target;
    if (target instanceof Element && target.closest("button, input")) return;
    tabDragData.current = { fromIndex: index, startX: e.clientX, pointerId: e.pointerId };
  };

  const onTabPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const data = tabDragData.current;
    if (!data || data.pointerId !== e.pointerId) return;
    const dx = e.clientX - data.startX;
    if (Math.abs(dx) < TAB_DRAG_THRESHOLD) return;
    // Determine which tab we're hovering over.
    const tabStrip = e.currentTarget;
    const children = Array.from(tabStrip.querySelectorAll<HTMLElement>("[data-tab-index]"));
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right) {
        const toIndex = parseInt(children[i].dataset.tabIndex!, 10);
        if (toIndex !== data.fromIndex) {
          setTabDragOver(toIndex);
        } else {
          setTabDragOver(null);
        }
        return;
      }
    }
    // Pointer left the tab strip — start panel-level drag instead.
    tabDragData.current = null;
    setTabDragOver(null);
    onDragStart(e);
  };

  const onTabPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const data = tabDragData.current;
    tabDragData.current = null;
    if (data && data.pointerId === e.pointerId && tabDragOver !== null && onReorderTabs) {
      onReorderTabs(data.fromIndex, tabDragOver);
    }
    setTabDragOver(null);
  };

  return (
    <div
      className={`panel-header${isActive ? " is-active" : ""}`}
      onPointerDown={startDrag}
      onClick={onFocus}
      data-panel-id={panel.id}
      data-panel-status={status}
    >
      <div
        className="panel-header-tabs"
        onPointerMove={onTabPointerMove}
        onPointerUp={onTabPointerUp}
        onPointerCancel={() => { tabDragData.current = null; setTabDragOver(null); }}
      >
        {tabs.map((tab, index) => {
          const isBgTab = !!tab.chatSessionId && !!backgroundChatIds?.has(tab.chatSessionId);
          const TabIcon = isBgTab ? Bot : (typeIcons[tab.type] ?? FileText);
          const isActiveTab = tab.id === activeTabId;
          const isDragOverTarget = tabDragOver === index;
          return (
            <div
              key={tab.id}
              className={`panel-header-tab${isActiveTab ? " is-active" : ""}${isDragOverTarget ? " is-drop-target" : ""}${isBgTab ? " is-background-agent" : ""}`}
              title={isBgTab
                ? `${tab.title} — a background agent is working in this chat. Closing the tab keeps it running in the background.`
                : tab.title}
              data-tab-index={index}
              onPointerDown={(e) => onTabPointerDown(e, index)}
              onClick={(e) => { e.stopPropagation(); onSwitchTab?.(tab.id); }}
              onAuxClick={(e) => { if (e.button === 1) { e.stopPropagation(); e.preventDefault(); onCloseTab?.(tab.id); } }}
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
                title={isBgTab ? "Close tab — the background agent keeps running" : "Close tab"}
                onClick={(e) => { e.stopPropagation(); onCloseTab?.(tab.id); }}
              >
                <X size={8} />
              </button>
            </div>
          );
        })}
        <button
          className="btn-icon btn-icon-sm panel-header-add-tab"
          type="button"
          title="Add a new tab to this panel"
          onClick={(e) => { e.stopPropagation(); onAddTab(); }}
        >
          <Plus size={11} />
        </button>
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
        <div className="panel-header-more-wrap">
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
              <button type="button" title={minimizable ? "Send to background agents" : "Close and move to history"} onClick={() => { setMenuOpen(false); onClose(); }}>
                {minimizable ? <Minus size={11} /> : <X size={11} />} {minimizable ? "Minimize" : "Close"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
