import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Rocket,
  Send,
  TerminalSquare,
  Trash2,
  Wrench,
} from "lucide-react";
import type { Plan, PlanStatus } from "../../lib/plans";
import { PLAN_STATUSES, PLAN_STATUS_LABEL, isTerminalStatus } from "../../lib/plans";
import type {
  EngineKind,
  LaunchProfile,
  SchedulingMode,
  ValidationResult,
  WorkspacePolicy,
} from "../../lib/planDependencies";
import {
  getLaunchProfile,
  setDependencies,
  setLaunchProfile,
  validateReadiness,
} from "../../lib/planDependencies";
import { PlanQueueSection } from "./PlanQueueSection";
import { openspecTaskProgress } from "../../lib/openspec";
import { PlanImportModal } from "./PlanImportModal";

type EffortLevel = "low" | "medium" | "high";

type ProfileForm = {
  engine: EngineKind;
  providerId: string;
  modelId: string;
  effortLevel: EffortLevel;
  skillId: string;
  workerCount: number;
  workspacePolicy: WorkspacePolicy;
  schedulingMode: SchedulingMode;
};

type PlanPanelProps = {
  sessionId: string | null;
  projectPath: string | null;
  plans: Plan[];
  loading: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onCreatePlan: () => void;
  onEditPlan: (plan: Plan) => void;
  onFocusPlan: (plan: Plan) => void;
  onSetPlanStatus: (id: string, status: PlanStatus) => void;
  onDeletePlan: (id: string) => void;
  onCopyReference: (refId: string) => void;
  onOpenInTerminal: (plan: Plan) => void;
  onOpenChatSession: (chatSessionId: string) => void;
  onAssignPlan?: (plan: Plan, profile: LaunchProfile) => void;
  onShowToast?: (title: string, detail?: string, kind?: "success" | "error") => void;
  showHeader?: boolean;
};

export function PlanPanel({
  sessionId,
  projectPath,
  plans,
  loading,
  collapsed,
  onToggleCollapse,
  onCreatePlan,
  onEditPlan,
  onFocusPlan,
  onSetPlanStatus,
  onDeletePlan,
  onCopyReference,
  onOpenInTerminal,
  onOpenChatSession,
  onAssignPlan,
  onShowToast,
  showHeader = true,
}: PlanPanelProps) {
  const [expandedFinished, setExpandedFinished] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [profileDefaults, setProfileDefaults] = useState<ProfileForm>({
    engine: "openspec",
    providerId: "",
    modelId: "",
    effortLevel: "medium",
    skillId: "",
    workerCount: 1,
    workspacePolicy: "isolated_worktrees",
    schedulingMode: "safe",
  });

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    void getLaunchProfile(projectPath).then((profile) => {
      if (cancelled || !profile) return;
      setProfileDefaults({
        engine: (profile.engine as EngineKind) ?? "openspec",
        providerId: profile.providerId ?? "",
        modelId: profile.modelId ?? "",
        effortLevel: (profile.effortLevel as EffortLevel) ?? "medium",
        skillId: profile.skillId ?? "",
        workerCount: profile.workerCount ?? 1,
        workspacePolicy: (profile.workspacePolicy as WorkspacePolicy) ?? "isolated_worktrees",
        schedulingMode: (profile.schedulingMode as SchedulingMode) ?? "safe",
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectPath]);

  const plansByStatus = useMemo(() => {
    const map = new Map<PlanStatus, Plan[]>();
    for (const status of PLAN_STATUSES) {
      map.set(status, []);
    }
    for (const plan of plans) {
      map.get(plan.status)?.push(plan);
    }
    return map;
  }, [plans]);

  if (collapsed) {
    return (
      <aside className="plan-panel plan-panel-collapsed" aria-label="Plans">
        <button
          className="btn-icon"
          title="Expand plans"
          aria-label="Expand plans"
          type="button"
          onClick={onToggleCollapse}
        >
          <ChevronLeft size={15} />
        </button>
        <span className="plan-panel-collapsed-count">{plans.filter((p) => !isTerminalStatus(p.status)).length}</span>
      </aside>
    );
  }

  return (
    <aside className="plan-panel" aria-label="Plans">
      {showHeader ? (
      <div className="plan-panel-header">
        <span className="plan-panel-title">Plans</span>
        <button
          className="btn-icon"
          title="Collapse plans"
          aria-label="Collapse plans"
          type="button"
          onClick={onToggleCollapse}
        >
          <ChevronRight size={15} />
        </button>
      </div>
      ) : (
        <div className="plan-panel-header-compact">
          <button
            className="btn-icon"
            title="Import plans from openspec/changes/"
            aria-label="Import plans"
            type="button"
            onClick={() => setShowImport(true)}
          >
            <Download size={14} />
          </button>
        </div>
      )}

      <div className="plan-panel-list">
        {!sessionId ? (
          <p className="text-muted text-sm pad">Open a project to manage plans.</p>
        ) : loading ? (
          <p className="text-muted text-sm pad">Loading plans…</p>
        ) : plans.length === 0 ? (
          <div className="plan-empty">
            <p className="text-muted text-sm">No plans yet.</p>
            <button className="btn btn-primary btn-sm" type="button" title="Create plan" onClick={onCreatePlan}>
                        <PlanCard
                          key={plan.id}
                          plan={plan}
                          projectPath={projectPath}
                          defaults={profileDefaults}
                          onEdit={onEditPlan}
                          onFocus={onFocusPlan}
                          onSetStatus={onSetPlanStatus}
                          onDeletePlan={onDeletePlan}
                          onCopyReference={onCopyReference}
                          onOpenInTerminal={onOpenInTerminal}
                          onAssignPlan={onAssignPlan}
                          onShowToast={onShowToast}
                        />
                  <button
                    className="plan-lane-header"
                    type="button"
                    onClick={() => setExpandedFinished((v) => !v)}
                  >
                    <span>{expandedFinished ? "▼" : "▶"}</span>
                    <span className="plan-lane-label">Finished / Cancelled</span>
                    <span className="plan-lane-count">{finishedCount}</span>
                  </button>
                  {expandedFinished ? (
                    <div className="plan-lane-cards">
                      {[...list, ...(plansByStatus.get("cancelled") ?? [])].map((plan) => (
                        <PlanCard
                          key={plan.id}
                          plan={plan}
                          projectPath={projectPath}
                          onEdit={onEditPlan}
                          onFocus={onFocusPlan}
                          onSetStatus={onSetPlanStatus}
                          onDeletePlan={onDeletePlan}
                          onCopyReference={onCopyReference}
                          onOpenInTerminal={onOpenInTerminal}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            }
            if (list.length === 0) return null;
            return (
              <div key={status} className="plan-lane">
                <div className="plan-lane-header">
                  <span className="plan-lane-label">{PLAN_STATUS_LABEL[status]}</span>
                  <span className="plan-lane-count">{list.length}</span>
                </div>
                <div className="plan-lane-cards">
                  {list.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      plan={plan}
                      projectPath={projectPath}
                      onEdit={onEditPlan}
                      onFocus={onFocusPlan}
                      onSetStatus={onSetPlanStatus}
                      onDeletePlan={onDeletePlan}
                      onCopyReference={onCopyReference}
                      onOpenInTerminal={onOpenInTerminal}
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
      <PlanQueueSection
        sessionId={sessionId}
        plans={plans}
        onOpenChatSession={onOpenChatSession}
      />
      {showImport ? (
        <PlanImportModal projectPath={projectPath} onClose={() => setShowImport(false)} />
      ) : null}
    </aside>
  );
}

type PlanCardProps = {
  plan: Plan;
  projectPath: string | null;
  onEdit: (plan: Plan) => void;
  onFocus: (plan: Plan) => void;
  onSetStatus: (id: string, status: PlanStatus) => void;
  onDeletePlan: (id: string) => void;
  onCopyReference: (refId: string) => void;
  onOpenInTerminal: (plan: Plan) => void;
};
function PlanCard({
  plan,
  projectPath,
  onEdit,
  onFocus,
  onSetStatus,
  onDeletePlan,
  onCopyReference,
  onOpenInTerminal,
}: PlanCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [taskProgress, setTaskProgress] = useState<{ completed: number; total: number } | null>(null);
  const isFinished = plan.status === "finished";

  useEffect(() => {
    if (!plan.changeName || !projectPath) return;
    let cancelled = false;
    void openspecTaskProgress(projectPath, plan.changeName).then((progress) => {
      if (!cancelled && progress.total > 0) setTaskProgress(progress);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [plan.changeName, projectPath]);

  const nextStatuses: PlanStatus[] = isFinished
    ? []
    : PLAN_STATUSES.filter((s) => s !== plan.status && !isTerminalStatus(s));

  return (
    <div className={`plan-card${plan.status === "running" ? " is-active" : ""}`}>
      <button
        className="plan-card-main"
        type="button"
        onClick={() => onFocus(plan)}
        title={plan.description}
      >
        <span className="plan-card-ref">{plan.referenceId}</span>
        <span className="plan-card-title">{plan.title}</span>
        {plan.aiEnhanced ? <span className="plan-card-ai" /> : null}
        {taskProgress && taskProgress.total > 0 ? (
          <span className="plan-card-progress" title={`${taskProgress.completed}/${taskProgress.total} tasks`}>
            {taskProgress.completed}/{taskProgress.total}
          </span>
        ) : null}
      </button>
      <div className="plan-card-actions">
        {!isFinished ? (
          <button
            className="btn-icon btn-icon-sm"
            title="Open in terminal"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenInTerminal(plan);
            }}
          >
            <TerminalSquare size={10} />
          </button>
        ) : null}
        <button
          className="btn-icon btn-icon-sm"
          title="Copy reference"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCopyReference(plan.referenceId);
          }}
        >
          <Copy size={10} />
        </button>
        <button
          className="btn-icon btn-icon-sm"
          title="Edit"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(plan);
          }}
        >
          <Pencil size={10} />
        </button>
        <div className="plan-card-menu-wrap">
          <button
            className="btn-icon btn-icon-sm"
            title="More"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            <MoreHorizontal size={10} />
          </button>
          {menuOpen ? (
            <div className="context-menu" onMouseLeave={() => setMenuOpen(false)}>
              {nextStatuses.map((status) => (
                <button
                  key={status}
                  className="menu-item text-sm"
                  type="button"
                  onClick={() => {
                    onSetStatus(plan.id, status);
                    setMenuOpen(false);
                  }}
                >
                  Move to {PLAN_STATUS_LABEL[status]}
                </button>
              ))}
              {!isFinished ? (
                <button
                  className="menu-item text-sm"
                  type="button"
                  onClick={() => {
                    onSetStatus(plan.id, "finished");
                    setMenuOpen(false);
                  }}
                >
                  Mark finished
                </button>
              ) : null}
              <button
                className="menu-item menu-item-danger text-sm"
                type="button"
                onClick={() => {
                    onDeletePlan(plan.id);
                    setMenuOpen(false);
                  }}
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
