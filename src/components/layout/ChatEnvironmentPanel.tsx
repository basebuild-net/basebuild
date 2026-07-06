import { useState } from "react";
import { ChevronDown, Folder, GitBranch, LayoutList } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { IdeaCategory } from "../../lib/ideas";
import type { NewPlan, Plan, PlanFocusContext } from "../../lib/plans";
import type { PlansState } from "../../state/plans";
import { PlanningInspector } from "./PlanningInspector";
import { SourcePanel } from "../panels/SourcePanel";

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
  activeChatSessionId: string | null;
  onOpenFiles: () => void;
  /** When true, auto-opens the Plans & Ideas fold (set by the chat-side inspector button). */
  openPlansFoldSignal?: number;
};

type FoldId = "source" | "plans" | "files";

const FOLDS: { id: FoldId; icon: LucideIcon; label: string }[] = [
  { id: "source", icon: GitBranch, label: "Changes" },
  { id: "plans", icon: LayoutList, label: "Plans & Ideas" },
  { id: "files", icon: Folder, label: "Files" },
];

export function ChatEnvironmentPanel({
  projectPath,
  sessionId,
  plans,
  planCallbacks,
  onOpenChatSession,
  onSuggestForCategory,
  activeChatSessionId,
  onOpenFiles,
  openPlansFoldSignal,
}: ChatEnvironmentPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [openFold, setOpenFold] = useState<FoldId | null>(null);

  // Auto-open the Plans fold when the chat-side inspector button fires.
  const lastSignalRef = useState<{ value: number }>({ value: 0 })[0];
  if (openPlansFoldSignal !== undefined && openPlansFoldSignal !== lastSignalRef.value) {
    lastSignalRef.value = openPlansFoldSignal;
    if (collapsed) setCollapsed(false);
    if (openFold !== "plans") setOpenFold("plans");
  }

  if (!projectPath) return null;

  const projectName = projectPath.split(/[\\/]/).pop() ?? projectPath;

  if (collapsed) {
    return (
      <div className="chat-env-panel is-collapsed" aria-label="Environment summary">
        <button
          className="chat-env-collapsed-btn"
          type="button"
          title={`Expand environment — ${projectName}`}
          onClick={() => setCollapsed(false)}
        >
          <GitBranch size={11} />
          <span className="mono">{projectName}</span>
          <span className="chat-env-dot" title="Healthy" />
        </button>
      </div>
    );
  }

  return (
    <div className="chat-env-panel" aria-label="Environment info">
      <div className="chat-env-header">
        <div className="chat-env-tabs">
          {FOLDS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              className={`chat-env-tab${openFold === id ? " is-active" : ""}`}
              type="button"
              title={label}
              onClick={() => (id === "files" ? onOpenFiles() : setOpenFold((cur) => (cur === id ? null : id)))}
            >
              <Icon size={11} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title="Collapse environment"
          onClick={() => setCollapsed(true)}
        >
          <ChevronDown size={12} />
        </button>
      </div>
      {openFold === "source" ? (
        <div className="chat-env-fold">
          <SourcePanel projectPath={projectPath} />
        </div>
      ) : openFold === "plans" ? (
        <div className="chat-env-fold">
          <PlanningInspector
            sessionId={sessionId}
            projectPath={projectPath}
            plans={plans.plans}
            loading={plans.loading}
            collapsed={false}
            onToggleCollapse={() => {}}
            {...planCallbacks}
            onSetPlanStatus={plans.setPlanStatus}
            onDeletePlan={plans.deletePlan}
            onOpenChatSession={onOpenChatSession}
            onSuggestForCategory={onSuggestForCategory}
            activeChatSessionId={activeChatSessionId}
            showHeader={false}
          />
        </div>
      ) : null}
    </div>
  );
}
