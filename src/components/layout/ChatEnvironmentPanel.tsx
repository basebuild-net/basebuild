import { useState } from "react";
import {
  ChevronDown,
  Folder,
  GitBranch,
  LayoutList,
  MessageSquare,
  Plus,
  TerminalSquare,
  Zap,
  LayoutTemplate,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { NotificationCenter } from "./NotificationCenter";
import type { IdeaCategory } from "../../lib/ideas";
import type { NewPlan, Plan, PlanFocusContext } from "../../lib/plans";
import type { PlansState } from "../../state/plans";

type ChatEnvironmentPanelProps = {
  projectPath: string | null;
  sessionId: string | null;
  plans: PlansState;
  planCallbacks: {
    onCreatePlan: () => void;
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

type FoldId = "source" | "plans" | "files";

const FOLDS: { id: FoldId; icon: LucideIcon; label: string }[] = [
  { id: "source", icon: GitBranch, label: "Changes" },
  { id: "plans", icon: LayoutList, label: "Plans & Ideas" },
  { id: "files", icon: Folder, label: "Files" },
];

const NEW_PANEL_OPTIONS: { type: "chat" | "terminal" | "omp" | "schematic"; icon: LucideIcon; label: string }[] = [
  { type: "chat", icon: MessageSquare, label: "Chat" },
  { type: "terminal", icon: TerminalSquare, label: "Terminal" },
  { type: "omp", icon: Zap, label: "Oh My Pi" },
  { type: "schematic", icon: LayoutTemplate, label: "Project Schematic" },
];

export function ChatEnvironmentPanel({
  projectPath,
  sessionId,
  plans,
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
              className="chat-env-tab"
              type="button"
              title={label}
              onClick={() => {
                if (id === "files") onOpenFiles();
                else if (id === "source") onOpenChanges();
                else if (id === "plans") onOpenPlans();
              }}
            >
              <Icon size={11} />
              <span>{label}</span>
            </button>
          ))}
          <div className="chat-env-add-wrapper">
            <button
              className="chat-env-tab chat-env-tab-add"
              type="button"
              title="New panel"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <Plus size={11} />
              <ChevronDown size={8} />
            </button>
            {menuOpen ? (
              <div className="chat-env-add-menu" onMouseLeave={() => setMenuOpen(false)}>
                {NEW_PANEL_OPTIONS.map(({ type, icon: Icon, label }) => (
                  <button
                    key={type}
                    type="button"
                    title={`New ${label} panel`}
                    onClick={() => { setMenuOpen(false); onCreatePanel(type); }}
                  >
                    <Icon size={11} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <NotificationCenter />
      </div>
    </div>
  );
}
