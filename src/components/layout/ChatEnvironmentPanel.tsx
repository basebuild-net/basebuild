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
  { type: "omp", icon: Zap, label: "Oh My Pi" },
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
  openPlansFoldSignal,
}: ChatEnvironmentPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { addLog } = useLogs();

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
              onClick={() => setMenuOpen((v) => !v)}
            >
              <Plus size={12} />
            </button>
            {menuOpen ? (
              <div className="chat-env-add-menu" onMouseLeave={() => setMenuOpen(false)}>
                {NEW_PANEL_OPTIONS.map(({ type, icon: Icon, label }) => (
                  <button
                    key={type}
                    type="button"
                    title={`New ${label} panel`}
                    onClick={() => {
                      addLog("debug", "New panel selected", `type=${type}; project=${projectPath}`);
                      setMenuOpen(false);
                      onCreatePanel(type);
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
