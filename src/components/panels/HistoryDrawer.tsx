import { useEffect, useState } from "react";
import { FileText, FolderOpen, LayoutTemplate, MessageSquare, TerminalSquare, Trash2, X, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Panel, PanelType } from "../../lib/panelGrid";
import { ConfirmDialog } from "../layout/ConfirmDialog";
import { nativeChatHistory, type NativeChatHistoryEntry } from "../../lib/native-chat";
import { formatRelativeTime } from "../../lib/timing";
import { basebuildDataDir, revealInExplorer } from "../../lib/projects";

const typeIcons: Record<PanelType, LucideIcon> = {
  chat: MessageSquare,
  terminal: TerminalSquare,
  file: FileText,
  schematic: LayoutTemplate,
  omp: Zap,
};

function projectDisplayName(projectPath: string): string {
  return projectPath.split(/[\\/]/).pop() ?? projectPath;
}

export type HistoryDrawerProps = {
  activeProjectPath: string | null;
  closedPanels: Panel[];
  onReopen: (panelId: string) => void;
  onDelete: (panelId: string) => void;
  onSelectProject: (path: string) => void;
  onClose: () => void;
};

export function HistoryDrawer({ activeProjectPath, closedPanels, onReopen, onDelete, onSelectProject, onClose }: HistoryDrawerProps) {
  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Load all chat sessions across projects for the modal.
  const [allChats, setAllChats] = useState<NativeChatHistoryEntry[]>([]);
  const [chatsError, setChatsError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    nativeChatHistory(200)
      .then((entries) => {
        if (cancelled) return;
        setAllChats(entries);
      })
      .catch((err) => {
        if (cancelled) return;
        setChatsError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, []);

  // Permanent deletion is confirm-gated: no automatic session/tab deletion.
  const [pendingDelete, setPendingDelete] = useState<Panel | null>(null);

  function handleChatClick(entry: NativeChatHistoryEntry) {
    const matchingClosedPanel = closedPanels.find(
      (p) => p.chatSessionId === entry.id && entry.projectPath === activeProjectPath,
    );
    if (matchingClosedPanel) {
      onReopen(matchingClosedPanel.id);
    } else if (entry.projectPath) {
      onSelectProject(entry.projectPath);
    }
    onClose();
  }

  return (
    <div className="modal-overlay" role="dialog" aria-label="History" onClick={onClose}>
      <div className="modal history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>History</h2>
          <div className="row gap-sm">
            <button
              className="btn btn-sm"
              type="button"
              title="Open the basebuild data folder in your file manager"
              onClick={() => void (async () => {
                try {
                  const dir = await basebuildDataDir();
                  await revealInExplorer(dir);
                } catch { /* best-effort */ }
              })()}
            >
              <FolderOpen size={12} /> Open folder
            </button>
            <button className="btn-icon" type="button" title="Close (Esc)" onClick={onClose}>
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="modal-body history-modal-body">
          <section className="history-modal-section" aria-label="History">
            <span className="history-modal-section-title">History</span>
            {closedPanels.length === 0 && (chatsError || allChats.length === 0) ? (
              <div className="history-modal-empty">
                {chatsError ? `Failed to load chats: ${chatsError}` : "No history yet."}
              </div>
            ) : (
              <div className="history-modal-list">
                {/* Closed panels first — these can be re-opened directly */}
                {closedPanels.map((panel) => {
                  const Icon = typeIcons[panel.type] ?? FileText;
                  return (
                    <div key={`closed-${panel.id}`} className="history-modal-item history-modal-item-closed">
                      <Icon size={11} className="history-modal-item-icon" />
                      <div className="history-modal-item-main">
                        <span className="history-modal-item-title" title={panel.title}>{panel.title}</span>
                        <span className="history-modal-item-meta">
                          <span className="history-modal-item-tag">closed</span>
                          <span>{panel.type}</span>
                        </span>
                      </div>
                      <div className="history-modal-closed-actions">
                        <button
                          className="btn btn-sm"
                          type="button"
                          title="Re-open this panel"
                          onClick={() => { onReopen(panel.id); onClose(); }}
                        >
                          Re-open
                        </button>
                        <button
                          className="btn-icon btn-icon-sm"
                          type="button"
                          title="Delete permanently"
                          onClick={() => setPendingDelete(panel)}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {/* All chat sessions — merged into the same list */}
                {allChats.map((entry) => {
                  const fullTs = new Date(entry.updatedAt * 1000).toLocaleString();
                  const messageLabel = entry.messageCount === 1 ? "1 message" : `${entry.messageCount} messages`;
                  const isClosed = closedPanels.some((p) => p.chatSessionId === entry.id && entry.projectPath === activeProjectPath);
                  return (
                    <div
                      key={`chat-${entry.id}`}
                      className="history-modal-item"
                      title={`${entry.title} — ${projectDisplayName(entry.projectPath)} — ${fullTs}`}
                      onClick={() => handleChatClick(entry)}
                    >
                      <MessageSquare size={11} className="history-modal-item-icon" />
                      <div className="history-modal-item-main">
                        <span className="history-modal-item-title">{entry.title}</span>
                        <span className="history-modal-item-meta">
                          <span className="history-modal-item-project">{projectDisplayName(entry.projectPath)}</span>
                          <span>{entry.modelId}</span>
                          <span>{formatRelativeTime(entry.updatedAt)}</span>
                          <span>{messageLabel}</span>
                          {isClosed ? <span className="history-modal-item-tag">closed</span> : null}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete panel permanently?"
        message={
          pendingDelete
            ? `Permanently delete "${pendingDelete.title}"? This removes the local ${pendingDelete.type} data and cannot be undone.`
            : ""
        }
        confirmLabel="Delete permanently"
        cancelLabel="Keep"
        destructive
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
