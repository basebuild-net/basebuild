import { useEffect } from "react";
import { Clock, FileText, LayoutTemplate, MessageSquare, TerminalSquare, Trash2, Zap, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Panel, PanelType } from "../../lib/panelGrid";

const typeIcons: Record<PanelType, LucideIcon> = {
  chat: MessageSquare,
  terminal: TerminalSquare,
  file: FileText,
  schematic: LayoutTemplate,
  omp: Zap,
};

function relativeTime(ts: number): string {
  if (!ts) return "";
  const now = Date.now();
  const diff = Math.floor((now - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export type HistoryDrawerProps = {
  closedPanels: Panel[];
  onReopen: (panelId: string) => void;
  onDelete: (panelId: string) => void;
  onClose: () => void;
};

export function HistoryDrawer({ closedPanels, onReopen, onDelete, onClose }: HistoryDrawerProps) {
  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="history-drawer" role="dialog" aria-label="Closed panels history">
      <div className="history-drawer-header">
        <span>History ({closedPanels.length})</span>
        <button className="btn-icon btn-icon-sm" type="button" title="Close history" onClick={onClose}>
          <X size={11} />
        </button>
      </div>
      {closedPanels.length === 0 ? (
        <div className="history-drawer-empty">No closed panels.</div>
      ) : (
        closedPanels.map((panel) => {
          const Icon = typeIcons[panel.type] ?? FileText;
          return (
            <div key={panel.id} className="history-drawer-item">
              <Icon size={11} className="history-drawer-item-icon" />
              <span className="history-drawer-item-title" title={panel.title}>{panel.title}</span>
              <div className="history-drawer-item-actions">
                <button
                  className="btn btn-sm"
                  type="button"
                  title="Re-open this panel"
                  onClick={() => onReopen(panel.id)}
                >
                  Re-open
                </button>
                <button
                  className="btn-icon btn-icon-sm"
                  type="button"
                  title="Delete permanently"
                  onClick={() => onDelete(panel.id)}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
