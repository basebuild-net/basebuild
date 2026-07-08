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
              Create plan
            </button>
          </div>
        ) : (
          PLAN_STATUSES.map((status) => {
            const list = plansByStatus.get(status) ?? [];
            if (isTerminalStatus(status)) {
              if (status !== "finished") return null;
              const finishedCount = list.length + (plansByStatus.get("cancelled")?.length ?? 0);
              if (finishedCount === 0) return null;
              return (
                <div key={status} className="plan-lane">
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
  defaults: ProfileForm;
  onEdit: (plan: Plan) => void;
  onFocus: (plan: Plan) => void;
  onSetStatus: (id: string, status: PlanStatus) => void;
  onDeletePlan: (id: string) => void;
  onCopyReference: (refId: string) => void;
  onOpenInTerminal: (plan: Plan) => void;
  onAssignPlan?: (plan: Plan, profile: LaunchProfile) => void;
  onShowToast?: (title: string, detail?: string, kind?: "success" | "error") => void;
};
function PlanCard({
  plan,
  projectPath,
  defaults,
  onEdit,
  onFocus,
  onSetStatus,
  onDeletePlan,
  onCopyReference,
  onOpenInTerminal,
  onAssignPlan,
  onShowToast,
}: PlanCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [taskProgress, setTaskProgress] = useState<{ completed: number; total: number } | null>(null);
  const isFinished = plan.status === "finished";
  const isDraftLike = plan.status === "draft" || plan.status === "openspec";
  const isReady = plan.status === "ready";

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

  const profileForAssign = useMemo<LaunchProfile>(() => ({
    projectPath: projectPath ?? "",
    engine: defaults.engine,
    providerId: defaults.providerId,
    modelId: defaults.modelId,
    effortLevel: defaults.effortLevel,
    skillId: defaults.skillId,
    workerCount: defaults.workerCount,
    workspacePolicy: defaults.workspacePolicy,
    schedulingMode: defaults.schedulingMode,
    updatedAt: Date.now(),
  }), [projectPath, defaults]);

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
        {validation ? (
          <span
            className={`plan-readiness-badge ${validation.errors.length > 0 ? "is-error" : validation.warnings.length > 0 ? "is-warn" : "is-valid"}`}
            title={validation.errors.concat(validation.warnings).join("\n") || "Ready to promote"}
          >
            {validation.errors.length > 0 ? <AlertCircle size={10} /> : validation.warnings.length > 0 ? <AlertCircle size={10} /> : <CheckCircle size={10} />}
            {validation.errors.length > 0 ? "Blocked" : validation.warnings.length > 0 ? "Warnings" : "Valid"}
          </span>
        ) : null}
        {plan.aiEnhanced ? <span className="plan-card-ai" /> : null}
        {taskProgress && taskProgress.total > 0 ? (
          <span className="plan-card-progress" title={`${taskProgress.completed}/${taskProgress.total} tasks`}>
            {taskProgress.completed}/{taskProgress.total}
          </span>
        ) : null}
      </button>
      <div className="plan-card-actions">
        {isReady && onAssignPlan ? (
          <button
            className="btn btn-sm btn-primary plan-assign-btn"
            title="Assign this ready plan to a chat session"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAssignPlan(plan, profileForAssign);
            }}
          >
            <Send size={10} /> Assign to chat
          </button>
        ) : null}
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
      {isDraftLike ? (
        <PlanPromotionForm
          plan={plan}
          defaults={defaults}
          projectPath={projectPath}
          onSetStatus={onSetStatus}
          onOpenInTerminal={onOpenInTerminal}
          onShowToast={onShowToast}
          onValidationChange={setValidation}
        />
      ) : null}
    </div>
  );
}

type PlanPromotionFormProps = {
  plan: Plan;
  defaults: ProfileForm;
  projectPath: string | null;
  onSetStatus: (id: string, status: PlanStatus) => void;
  onOpenInTerminal: (plan: Plan) => void;
  onShowToast?: (title: string, detail?: string, kind?: "success" | "error") => void;
  onValidationChange?: (result: ValidationResult | null) => void;
};

const EFFORT_OPTIONS: EffortLevel[] = ["low", "medium", "high"];
const ENGINE_OPTIONS: EngineKind[] = ["openspec", "native"];
const WORKSPACE_OPTIONS: WorkspacePolicy[] = ["isolated_worktrees", "sequential_primary"];
const SCHEDULING_OPTIONS: SchedulingMode[] = ["safe", "yolo"];

function PlanPromotionForm({
  plan,
  defaults,
  projectPath,
  onSetStatus,
  onOpenInTerminal,
  onShowToast,
  onValidationChange,
}: PlanPromotionFormProps) {
  const [form, setForm] = useState<ProfileForm>(() => defaults);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [reviseMessage, setReviseMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setForm(defaults);
  }, [defaults]);

  useEffect(() => {
    onValidationChange?.(validation);
  }, [validation, onValidationChange]);

  const runValidation = useCallback(async () => {
    setLoading(true);
    setReviseMessage(null);
    try {
      await setDependencies({
        planId: plan.id,
        prerequisites: [],
        affectedPaths: [],
        priority: plan.priority,
        schedulingMode: form.schedulingMode,
        workspacePolicy: form.workspacePolicy,
      });
      const result = await validateReadiness(plan.id);
      setValidation(result);
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const errorResult: ValidationResult = { planId: plan.id, valid: false, errors: [message], warnings: [] };
      setValidation(errorResult);
      return errorResult;
    } finally {
      setLoading(false);
    }
  }, [plan, form]);

  const handlePromote = useCallback(async () => {
    setReviseMessage(null);
    const result = await runValidation();
    if (!result.valid || result.errors.length > 0) return;
    try {
      await setLaunchProfile({
        projectPath: projectPath ?? "",
        engine: form.engine,
        providerId: form.providerId,
        modelId: form.modelId,
        effortLevel: form.effortLevel,
        skillId: form.skillId,
        workerCount: form.workerCount,
        workspacePolicy: form.workspacePolicy,
        schedulingMode: form.schedulingMode,
        updatedAt: Date.now(),
      });
      await onSetStatus(plan.id, "ready");
      onShowToast?.("Plan promoted to ready", `${plan.referenceId} ${plan.title}`, "success");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      onShowToast?.("Failed to promote plan", message, "error");
    }
  }, [plan, form, projectPath, onSetStatus, onShowToast, runValidation]);

  const handleRevalidate = useCallback(async () => {
    await runValidation();
  }, [runValidation]);

  const handleRevise = useCallback(() => {
    if (plan.changeName) {
      onOpenInTerminal(plan);
    } else {
      setReviseMessage("Generate artifacts first");
    }
  }, [plan, onOpenInTerminal]);

  const hasErrors = validation ? validation.errors.length > 0 : false;
  const hasWarnings = validation ? validation.warnings.length > 0 : false;

  return (
    <div className="plan-promotion-form stack-sm">
      <div className="plan-promotion-header">
        <Rocket size={11} />
        <span className="text-sm">Launch profile</span>
      </div>
      <div className="plan-promotion-fields">
        <label className="plan-promotion-field" title="Engine">
          <span className="plan-promotion-label">Engine</span>
          <select
            className="input plan-promotion-input"
            title="Engine"
            value={form.engine}
            onChange={(e) => setForm((prev) => ({ ...prev, engine: e.target.value as EngineKind }))}
          >
            {ENGINE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </label>
        <label className="plan-promotion-field" title="Provider">
          <span className="plan-promotion-label">Provider</span>
          <input
            className="input plan-promotion-input"
            type="text"
            title="Provider"
            placeholder="Provider"
            value={form.providerId}
            onChange={(e) => setForm((prev) => ({ ...prev, providerId: e.target.value }))}
          />
        </label>
        <label className="plan-promotion-field" title="Model">
          <span className="plan-promotion-label">Model</span>
          <input
            className="input plan-promotion-input"
            type="text"
            title="Model"
            placeholder="Model"
            value={form.modelId}
            onChange={(e) => setForm((prev) => ({ ...prev, modelId: e.target.value }))}
          />
        </label>
        <label className="plan-promotion-field" title="Effort">
          <span className="plan-promotion-label">Effort</span>
          <select
            className="input plan-promotion-input"
            title="Effort"
            value={form.effortLevel}
            onChange={(e) => setForm((prev) => ({ ...prev, effortLevel: e.target.value as EffortLevel }))}
          >
            {EFFORT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </label>
        <label className="plan-promotion-field" title="Skill">
          <span className="plan-promotion-label">Skill</span>
          <input
            className="input plan-promotion-input"
            type="text"
            title="Skill"
            placeholder="Skill"
            value={form.skillId}
            onChange={(e) => setForm((prev) => ({ ...prev, skillId: e.target.value }))}
          />
        </label>
        <label className="plan-promotion-field" title="Workers">
          <span className="plan-promotion-label">Workers</span>
          <input
            className="input plan-promotion-input"
            type="number"
            title="Workers"
            min={1}
            max={32}
            value={form.workerCount}
            onChange={(e) => setForm((prev) => ({ ...prev, workerCount: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
          />
        </label>
        <label className="plan-promotion-field" title="Workspace policy">
          <span className="plan-promotion-label">Workspace</span>
          <select
            className="input plan-promotion-input"
            title="Workspace policy"
            value={form.workspacePolicy}
            onChange={(e) => setForm((prev) => ({ ...prev, workspacePolicy: e.target.value as WorkspacePolicy }))}
          >
            {WORKSPACE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
        <label className="plan-promotion-field" title="Scheduling mode">
          <span className="plan-promotion-label">Scheduling</span>
          <select
            className="input plan-promotion-input"
            title="Scheduling mode"
            value={form.schedulingMode}
            onChange={(e) => setForm((prev) => ({ ...prev, schedulingMode: e.target.value as SchedulingMode }))}
          >
            {SCHEDULING_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </label>
      </div>
      {validation ? (
        <div className="plan-promotion-validation stack-sm">
          {validation.errors.length > 0 ? (
            <div className="plan-promotion-messages is-error">
              {validation.errors.map((err, i) => (
                <p key={i} className="text-sm text-danger">{err}</p>
              ))}
            </div>
          ) : null}
          {validation.warnings.length > 0 ? (
            <div className="plan-promotion-messages is-warn">
              {validation.warnings.map((warn, i) => (
                <p key={i} className="text-sm text-warn">{warn}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {reviseMessage ? <p className="text-sm text-muted">{reviseMessage}</p> : null}
      <div className="plan-promotion-actions">
        <button
          className="btn btn-sm btn-primary"
          type="button"
          title="Validate readiness and promote to ready"
          disabled={loading || hasErrors}
          onClick={() => void handlePromote()}
        >
          {loading ? <RefreshCw size={11} className="is-spinning" /> : <Rocket size={11} />}
          Validate & Promote to Ready
        </button>
        {validation ? (
          <button
            className="btn btn-sm"
            type="button"
            title="Re-validate plan readiness"
            disabled={loading}
            onClick={() => void handleRevalidate()}
          >
            <RefreshCw size={11} /> Re-validate
          </button>
        ) : null}
        {hasErrors ? (
          <button
            className="btn btn-sm"
            type="button"
            title="Open the linked change directory in a terminal"
            onClick={handleRevise}
          >
            <Wrench size={11} /> Revise artifacts
          </button>
        ) : null}
      </div>
    </div>
  );
}
