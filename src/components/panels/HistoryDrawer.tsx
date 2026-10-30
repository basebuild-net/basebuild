import { useEffect, useState } from "react";
import { FileText, FolderOpen, LayoutTemplate, MessageSquare, TerminalSquare, Trash2, X, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Panel, PanelType } from "../../lib/panelGrid";
import { ConfirmDialog } from "../layout/ConfirmDialog";
import { ModalPortal } from "../ModalPortal";
import { nativeChatHistory, type NativeChatHistoryEntry } from "../../lib/native-chat";
import { formatRelativeTime } from "../../lib/timing";
import { basebuildDataDir, revealInExplorer } from "../../lib/projects";
import { SkeletonRows } from "../layout/Loading";
import { t } from "../../i18n";

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
  // Starts true: the mount fetch below is the only source of `allChats`, and
  // the first commit otherwise rendered "No history yet."
  const [chatsLoading, setChatsLoading] = useState(true);
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
      })
      .finally(() => {
        if (!cancelled) setChatsLoading(false);
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
    <ModalPortal>
    <div className="modal-overlay" role="dialog" aria-label={t("historyDrawer.history")} onClick={onClose}>
      <div className="modal history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("historyDrawer.history")}</h2>
          <div className="row gap-sm">
            <button
              className="btn btn-sm"
              type="button"
              title={t("historyDrawer.openTheBasebuildDataFolder")}
              onClick={() => void (async () => {
                try {
                  const dir = await basebuildDataDir();
                  await revealInExplorer(dir);
                } catch { /* best-effort */ }
              })()}
            >
              <FolderOpen size={12} /> {t("historyDrawer.openFolder")}
            </button>
            <button className="btn-icon" type="button" title={t("historyDrawer.closeEsc")} onClick={onClose}>
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="modal-body history-modal-body">
          <section className="history-modal-section" aria-label={t("historyDrawer.history")}>
            <span className="history-modal-section-title">{t("historyDrawer.history")}</span>
            {chatsLoading && closedPanels.length === 0 ? (
              <SkeletonRows rows={4} label={t("historyDrawer.loadingHistory")} />
            ) : closedPanels.length === 0 && (chatsError || allChats.length === 0) ? (
              <div className="history-modal-empty">
                {chatsError ? t("historyDrawer.failedToLoadChats", { chatsError: chatsError }) : t("historyDrawer.noHistoryYet")}
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
                          <span className="history-modal-item-tag">{t("historyDrawer.closed")}</span>
                          <span>{panel.type}</span>
                        </span>
                      </div>
                      <div className="history-modal-closed-actions">
                        <button
                          className="btn btn-sm"
                          type="button"
                          title={t("historyDrawer.reOpenThisPanel")}
                          onClick={() => { onReopen(panel.id); onClose(); }}
                        >
                          {t("historyDrawer.reOpen")}
                        </button>
                        <button
                          className="btn-icon btn-icon-sm"
                          type="button"
                          title={t("historyDrawer.deletePermanently")}
                          onClick={() => setPendingDelete(panel)}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {chatsLoading ? <SkeletonRows rows={2} label={t("historyDrawer.loadingChatHistory")} /> : null}
                {/* All chat sessions — merged into the same list */}
                {allChats.map((entry) => {
                  const fullTs = new Date(entry.updatedAt * 1000).toLocaleString();
                  const messageLabel = entry.messageCount === 1 ? "1 message" : `${entry.messageCount} messages`;
                  const isClosed = closedPanels.some((p) => p.chatSessionId === entry.id && entry.projectPath === activeProjectPath);
                  return (
                    <div
                      key={`chat-${entry.id}`}
                      className="history-modal-item"
                      title={t("historyDrawer.text", { title: entry.title, projectPath: projectDisplayName(entry.projectPath), fullTs: fullTs })}
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
                          {isClosed ? <span className="history-modal-item-tag">{t("historyDrawer.closed")}</span> : null}
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
        title={t("historyDrawer.deletePanelPermanently")}
        message={
          pendingDelete
            ? `Permanently delete "${pendingDelete.title}"? This removes the local ${pendingDelete.type} data and cannot be undone.`
            : ""
        }
        confirmLabel={t("historyDrawer.deletePermanently2")}
        cancelLabel={t("historyDrawer.keep")}
        destructive
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
    </ModalPortal>
  );
}
