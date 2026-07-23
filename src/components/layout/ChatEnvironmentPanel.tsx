import { useState } from "react";
import {
  ChevronDown,
  Folder,
  GitBranch,
  MessageSquare,
  Plus,
  TerminalSquare,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { IdeaCategory } from "../../lib/ideas";
import type { NewPlan, Plan, PlanFocusContext } from "../../lib/plans";
import type { PlansState } from "../../state/plans";
import { useLogs } from "../../state/log";

type ChatEnvironmentPanelProps = {
  projectPath: string | null;
  sessionId: string | null;
  plans: PlansState;
  planCallbacks: {

    onEditPlan: (plan: Plan) => void;
    onFocusPlan: (plan: Plan) => void;
    onCopyReference: (refId: string) => void;
    onOpenInTerminal: (plan: Plan) => void;
  };
  onOpenChatSession: (chatSessionId: string) => void;
  onSuggestForCategory: (category: IdeaCategory | null) => void;
  onGenerateCategories?: () => void;
  onOpenFiles: () => void;
  onOpenChanges: () => void;
  onOpenPlans: () => void;
  onCreatePanel: (type: "chat" | "terminal" | "omp" | "schematic") => void;
  /** Whether the OMP CLI is installed; gates the optional "Oh My Pi" panel option. */
  ompInstalled?: boolean;
  /** When true, auto-opens the Plans & Ideas modal (set by the chat-side inspector button). */
  openPlansFoldSignal?: number;
};

type FoldId = "source" | "files";

const FOLDS: { id: FoldId; icon: LucideIcon; label: string }[] = [
  { id: "source", icon: GitBranch, label: "Changes" },
  { id: "files", icon: Folder, label: "Files" },
];

const NEW_PANEL_OPTIONS: { type: "chat" | "terminal" | "omp" | "schematic"; icon: LucideIcon; label: string }[] = [
  { type: "chat", icon: MessageSquare, label: "Chat" },
  { type: "terminal", icon: TerminalSquare, label: "Terminal" },
  { type: "omp", icon: Zap, label: "Oh My Pi Chat" },
];

export function ChatEnvironmentPanel({
  projectPath,
  sessionId,
  plans: _plans,
  planCallbacks,
  onOpenChatSession,
  onSuggestForCategory,
  onGenerateCategories,
  onOpenFiles,
  onOpenChanges,
  onOpenPlans,
  onCreatePanel,
  ompInstalled,
  openPlansFoldSignal,
}: ChatEnvironmentPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { addLog } = useLogs();
  // OMP is an optional enhancement: only offer the "Oh My Pi" panel when the
  // OMP CLI is actually installed. Native chat/terminal are always available.
  const panelOptions = NEW_PANEL_OPTIONS.filter((o) => o.type !== "omp" || ompInstalled);

  // Auto-open the Plans modal when the chat-side inspector button fires.
  const lastSignalRef = useState<{ value: number }>({ value: 0 })[0];
  if (openPlansFoldSignal !== undefined && openPlansFoldSignal !== lastSignalRef.value) {
    lastSignalRef.value = openPlansFoldSignal;
    onOpenPlans();
  }

  if (!projectPath) return null;

  return (
    <div className="chat-env-panel" aria-label="Environment info">
      <div className="chat-env-header">
        <div className="chat-env-tabs">
          {FOLDS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              className="chat-env-tab chat-env-tab-icon"
              type="button"
              title={label}
              onClick={() => {
                addLog("debug", "Project utility opened", `surface=${id}; project=${projectPath}`);
                if (id === "files") onOpenFiles();
                else onOpenChanges();
              }}
            >
              <Icon size={12} />
            </button>
          ))}
          <div className="chat-env-add-wrapper">
            <button
              className="chat-env-tab chat-env-tab-add"
              type="button"
              title="New panel"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && menuOpen) { setMenuOpen(false); }
              }}
            >
              <Plus size={12} />
            </button>
            {menuOpen ? (
              <div
                className="chat-env-add-menu"
                role="menu"
                aria-label="New panel"
                onMouseLeave={() => setMenuOpen(false)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setMenuOpen(false); }
                }}
              >
                {panelOptions.map(({ type, icon: Icon, label }, index) => (
                  <button
                    key={type}
                    type="button"
                    role="menuitem"
                    title={`New ${label} panel`}
                    autoFocus={index === 0}
                    onClick={() => {
                      addLog("debug", "New panel selected", `type=${type}; project=${projectPath}`);
                      setMenuOpen(false);
                      onCreatePanel(type);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        const next = e.currentTarget.nextElementSibling as HTMLElement | null;
                        (next ?? e.currentTarget.parentElement?.firstElementChild as HTMLElement)?.focus();
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        const prev = e.currentTarget.previousElementSibling as HTMLElement | null;
                        (prev ?? e.currentTarget.parentElement?.lastElementChild as HTMLElement)?.focus();
                      } else if (e.key === "Home") {
                        e.preventDefault();
                        (e.currentTarget.parentElement?.firstElementChild as HTMLElement)?.focus();
                      } else if (e.key === "End") {
                        e.preventDefault();
                        (e.currentTarget.parentElement?.lastElementChild as HTMLElement)?.focus();
                      }
                    }}
                  >
                    <Icon size={11} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
