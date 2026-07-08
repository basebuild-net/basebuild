import { useEffect, useState } from "react";
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

import { NotificationCenter } from "./NotificationCenter";
import type { IdeaCategory } from "../../lib/ideas";
import type { NewPlan, Plan, PlanFocusContext } from "../../lib/plans";
import type { PlansState } from "../../state/plans";
import { gitCurrentBranch } from "../../lib/git";
import { listWorkspaces } from "../../lib/workspaces";
import { useLogs } from "../../state/log";

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
  const [branch, setBranch] = useState<string | null>(null);
  const [worktreePath, setWorktreePath] = useState<string | null>(null);
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null);
  const { addLog } = useLogs();

  // Auto-open the Plans modal when the chat-side inspector button fires.
  const lastSignalRef = useState<{ value: number }>({ value: 0 })[0];
  if (openPlansFoldSignal !== undefined && openPlansFoldSignal !== lastSignalRef.value) {
    lastSignalRef.value = openPlansFoldSignal;
    onOpenPlans();
  }

  // Load workspace/branch context for the header badges.
  useEffect(() => {
    if (!projectPath) {
      setBranch(null);
      setWorktreePath(null);
      setGitAvailable(null);
      return;
    }
    const path = projectPath;
    let cancelled = false;
    async function load() {
      try {
        const [br, workspaces] = await Promise.all([
          gitCurrentBranch(path).catch(() => null),
          listWorkspaces(path).catch(() => []),
        ]);
        if (cancelled) return;
        setGitAvailable(br !== null);
        setBranch(br);
        const match = workspaces.find((w) => w.branch === br);
        setWorktreePath(match?.path ?? null);
      } catch {
        if (!cancelled) {
          setGitAvailable(false);
        }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [projectPath]);

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
                addLog("debug", "Project utility opened", `surface=${id}; project=${projectPath}`);
                if (id === "files") onOpenFiles();
                else onOpenChanges();
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
              <span>New</span>
              <ChevronDown size={8} />
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
      <div className="chat-env-context">
        {projectPath ? (
          <span
            className="chat-context-badge"
            title={`Project: ${projectPath}`}
          >
            {projectPath.split(/[\\/]/).pop() ?? projectPath}
          </span>
        ) : null}
        {gitAvailable ? (
          <>
            <span className="chat-context-badge" title={`Branch: ${branch ?? "unknown"}`}>
              <GitBranch size={10} />
              {branch ?? "unknown"}
            </span>
            {worktreePath ? (
              <span className="chat-context-badge" title={`Worktree: ${worktreePath}`}>
                worktree
              </span>
            ) : (
              <span
                className="chat-context-badge"
                title="Primary workspace: this chat is using the open project checkout"
              >
                primary workspace
              </span>
            )}
          </>
        ) : (
          <span
            className="chat-context-badge chat-context-badge-warn"
            title="Non-Git project: workspace isolation and branch switching are unavailable"
          >
            non-Git
          </span>
        )}
        {(() => {
          const runningPlan = plans.plans.find((p) => p.status === "running");
          const readyPlan = plans.plans.find((p) => p.status === "ready");
          const activePlan = runningPlan ?? readyPlan;
          return activePlan ? (
            <span
              className="chat-context-badge"
              title={`Plan reference: ${activePlan.referenceId} - ${activePlan.title}`}
            >
              #{activePlan.referenceId}
            </span>
          ) : null;
        })()}
      </div>
    </div>
  );
}
