import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { PLAN_STATUS_DISPLAY_ORDER, PLAN_STATUSES, PLAN_STATUS_LABEL, isTerminalStatus } from "../../lib/plans";
import type {
  EngineKind,
  FinishPolicy,
  LaunchProfile,
  SchedulingMode,
  ValidationResult,
  WorkspacePolicy,
} from "../../lib/planDependencies";
import {
  getDependencies,
  getLaunchProfile,
  setDependencies,
  setLaunchProfile,
  validateReadiness,
} from "../../lib/planDependencies";
import { PlanQueueSection } from "./PlanQueueSection";
import { openspecTaskProgress } from "../../lib/openspec";
import { useOpenSpecRuntime } from "../../state/useOpenSpecRuntime";
import { PlanImportModal } from "./PlanImportModal";
import { OptionList, type OptionListOption } from "./OptionList";
import { listResolvedSkills, type ResolvedSkill } from "../../lib/skillRegistry";
import { ExecutionAdvisorCard } from "../planning/ExecutionAdvisorCard";
import {
  nativeChatBootstrap,
  nativeChatSetProjectModelDefault,
  type NativeProviderCatalog,
} from "../../lib/native-chat";

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
  finishPolicy: FinishPolicy;
};

type PlanPanelProps = {
  sessionId: string | null;
  projectPath: string | null;
  plans: Plan[];
  loading: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;

  onEditPlan: (plan: Plan) => void;
  onFocusPlan: (plan: Plan) => void;
  onSetPlanStatus: (id: string, status: PlanStatus) => void | Promise<unknown>;
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
    finishPolicy: "hold",
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
        finishPolicy: (profile.finishPolicy as FinishPolicy) ?? "hold",
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
          <div className="plan-empty plan-empty-ai">
            <p className="text-muted text-sm">No plans yet.</p>
            <p className="text-muted text-sm">Generate ideas with AI, then promote the ones worth building.</p>
          </div>
        ) : (
          PLAN_STATUS_DISPLAY_ORDER.map((status) => {
            const list = plansByStatus.get(status) ?? [];
            if (isTerminalStatus(status)) {
              if (status !== "finished") return null;
              const finishedCount = list.length + (plansByStatus.get("cancelled")?.length ?? 0);
              if (finishedCount === 0) return null;
              return (
                <div key={status} className="plan-lane" data-status="finished">
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
              <div key={status} className="plan-lane" data-status={status}>
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
        projectPath={projectPath}
        plans={plans}
        onOpenChatSession={onOpenChatSession}
        onShowToast={onShowToast}
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
    finishPolicy: defaults.finishPolicy ?? "hold",
    updatedAt: Date.now(),
  }), [projectPath, defaults]);

  return (
    <div className={`plan-card${plan.status === "running" ? " is-active" : ""}`} data-status={plan.status}>
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
              {plan.status === "running" ? (
                <button
                  className="menu-item text-sm"
                  type="button"
                  onClick={() => {
                    onSetStatus(plan.id, "finished");
                    setMenuOpen(false);
                  }}
                >
                  Mark complete
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
      {projectPath && plan.assessment ? (
        <ExecutionAdvisorCard projectPath={projectPath} planId={plan.id} compact />
      ) : null}
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
  onSetStatus: (id: string, status: PlanStatus) => void | Promise<unknown>;
  onOpenInTerminal: (plan: Plan) => void;
  onShowToast?: (title: string, detail?: string, kind?: "success" | "error") => void;
  onValidationChange?: (result: ValidationResult | null) => void;
};

const EFFORT_OPTION_ITEMS: OptionListOption<EffortLevel>[] = [
  { id: "low", label: "low", title: "Low effort — smaller, faster runs" },
  { id: "medium", label: "medium", title: "Medium effort — balanced depth and speed" },
  { id: "high", label: "high", title: "High effort — deeper, more thorough runs" },
];
const WORKSPACE_OPTION_ITEMS: OptionListOption<WorkspacePolicy>[] = [
  { id: "isolated_worktrees", label: "isolated worktrees", title: "Each run uses its own isolated worktree" },
  { id: "sequential_primary", label: "sequential primary", title: "Run sequentially in the primary worktree" },
];
const SCHEDULING_OPTION_ITEMS: OptionListOption<SchedulingMode>[] = [
  { id: "safe", label: "safe", title: "Safe scheduling — conservative dependency ordering" },
  { id: "yolo", label: "yolo", title: "Eager scheduling — run as soon as possible" },
];

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
  const [resolvedSkills, setResolvedSkills] = useState<ResolvedSkill[]>([]);
  const [skillsFailed, setSkillsFailed] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const skillPickerRef = useRef<HTMLDivElement | null>(null);
  const runtime = useOpenSpecRuntime(projectPath);
  const runtimeReady = runtime.status?.state === "ready";
  const [modelCatalog, setModelCatalog] = useState<NativeProviderCatalog | null>(null);
  const [plannerProviderId, setPlannerProviderId] = useState("");
  const [plannerModelId, setPlannerModelId] = useState("");
  const [plannerEffortLevel, setPlannerEffortLevel] = useState<EffortLevel>("medium");
  const configuredProviders = useMemo(
    () => modelCatalog?.providers.filter((provider) => provider.configured) ?? [],
    [modelCatalog],
  );
  const plannerModels = useMemo(
    () => modelCatalog?.models.filter((model) => model.providerId === plannerProviderId) ?? [],
    [modelCatalog, plannerProviderId],
  );
  const codingModels = useMemo(
    () => modelCatalog?.models.filter((model) => model.providerId === form.providerId) ?? [],
    [modelCatalog, form.providerId],
  );

  useEffect(() => {
    setForm(defaults);
  }, [defaults]);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    void nativeChatBootstrap(projectPath)
      .then(({ catalog, resolved }) => {
        if (cancelled) return;
        setModelCatalog(catalog);
        setPlannerProviderId(resolved.providerId);
        setPlannerModelId(resolved.modelId);
        setPlannerEffortLevel(
          resolved.effortLevel === "low" || resolved.effortLevel === "high"
            ? resolved.effortLevel
            : "medium",
        );
        setForm((current) => ({
          ...current,
          engine: "openspec",
          providerId: current.providerId || resolved.providerId,
          modelId: current.modelId || resolved.modelId,
          effortLevel: current.effortLevel || "medium",
        }));
      })
      .catch((error) => {
        if (!cancelled) setReviseMessage(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, [projectPath]);

  useEffect(() => {
    onValidationChange?.(validation);
  }, [validation, onValidationChange]);

  useEffect(() => {
    let cancelled = false;
    listResolvedSkills()
      .then((skills) => {
        if (cancelled) return;
        if (skills.length === 0) {
          setSkillsFailed(true);
        } else {
          setResolvedSkills(skills);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSkillsFailed(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!skillMenuOpen) return;
    function handleDocumentClick(e: MouseEvent) {
      if (!skillPickerRef.current) return;
      if (!skillPickerRef.current.contains(e.target as Node)) {
        setSkillMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, [skillMenuOpen]);

  const runValidation = useCallback(async () => {
    setLoading(true);
    setReviseMessage(null);
    try {
      const existing = await getDependencies(plan.id).catch(() => null);
      await setDependencies({
        planId: plan.id,
        prerequisites: existing?.prerequisites ?? [],
        affectedPaths: existing?.affectedPaths ?? [],
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

  const persistExecutionProfile = useCallback(
    () => setLaunchProfile({
      projectPath: projectPath ?? "",
      engine: "openspec",
      providerId: form.providerId || plannerProviderId,
      modelId: form.modelId || plannerModelId,
      effortLevel: form.effortLevel,
      skillId: form.skillId,
      workerCount: form.workerCount,
      workspacePolicy: form.workspacePolicy,
      schedulingMode: form.schedulingMode,
      finishPolicy: form.finishPolicy ?? "hold",
      updatedAt: Date.now(),
    }),
    [projectPath, form, plannerProviderId, plannerModelId],
  );

  const handleGenerateOpenSpec = useCallback(async () => {
    if (!projectPath || !plannerProviderId || !plannerModelId) {
      setReviseMessage("Choose a planner provider and model first.");
      return;
    }
    setLoading(true);
    setReviseMessage(null);
    try {
      await nativeChatSetProjectModelDefault(projectPath, {
        providerId: plannerProviderId,
        modelId: plannerModelId,
        effortLevel: plannerEffortLevel,
      });
      await persistExecutionProfile();
      await onSetStatus(plan.id, "openspec");
      onShowToast?.("OpenSpec plan generated", `${plan.referenceId} ${plan.title}`, "success");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setReviseMessage(message);
      onShowToast?.("OpenSpec generation failed", message, "error");
    } finally {
      setLoading(false);
    }
  }, [
    projectPath,
    plannerProviderId,
    plannerModelId,
    plannerEffortLevel,
    persistExecutionProfile,
    onSetStatus,
    plan,
    onShowToast,
  ]);

  const handlePromote = useCallback(async () => {
    setReviseMessage(null);
    const result = await runValidation();
    if (!result.valid || result.errors.length > 0) return;
    try {
      await persistExecutionProfile();
      await onSetStatus(plan.id, "ready");
      onShowToast?.("Plan approved and ready", `${plan.referenceId} ${plan.title}`, "success");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setReviseMessage(message);
      onShowToast?.("Failed to approve plan", message, "error");
    }
  }, [plan, onSetStatus, onShowToast, runValidation, persistExecutionProfile]);

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
        <span className="text-sm">OpenSpec launch profile</span>
      </div>
      <div className="plan-promotion-fields">
        <label className="plan-promotion-field" title="Provider used to generate and revise OpenSpec artifacts">
          <span className="plan-promotion-label">Planner provider</span>
          <select
            className="input plan-promotion-input"
            title="Planner provider"
            value={plannerProviderId}
            disabled={configuredProviders.length === 0}
            onChange={(event) => {
              const providerId = event.target.value;
              const modelId = modelCatalog?.models.find((model) => model.providerId === providerId)?.id ?? "";
              setPlannerProviderId(providerId);
              setPlannerModelId(modelId);
            }}
          >
            {configuredProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.label}</option>
            ))}
          </select>
        </label>
        <label className="plan-promotion-field" title="Model used to generate and revise OpenSpec artifacts">
          <span className="plan-promotion-label">Planner model</span>
          <select
            className="input plan-promotion-input"
            title="Planner model"
            value={plannerModelId}
            disabled={plannerModels.length === 0}
            onChange={(event) => setPlannerModelId(event.target.value)}
          >
            {plannerModels.map((model) => (
              <option key={model.id} value={model.id}>{model.label}</option>
            ))}
          </select>
        </label>
        <label className="plan-promotion-field" title="Reasoning effort used while planning">
          <span className="plan-promotion-label">Planner effort</span>
          <OptionList
            value={plannerEffortLevel}
            options={EFFORT_OPTION_ITEMS}
            onChange={setPlannerEffortLevel}
            label="Planner effort"
          />
        </label>
        <label className="plan-promotion-field" title="Provider used to implement the approved plan">
          <span className="plan-promotion-label">Coding provider</span>
          <select
            className="input plan-promotion-input"
            title="Coding provider"
            value={form.providerId}
            disabled={configuredProviders.length === 0}
            onChange={(event) => {
              const providerId = event.target.value;
              const modelId = modelCatalog?.models.find((model) => model.providerId === providerId)?.id ?? "";
              setForm((current) => ({ ...current, providerId, modelId }));
            }}
          >
            {configuredProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.label}</option>
            ))}
          </select>
        </label>
        <label className="plan-promotion-field" title="Model used to implement the approved plan">
          <span className="plan-promotion-label">Coding model</span>
          <select
            className="input plan-promotion-input"
            title="Coding model"
            value={form.modelId}
            disabled={codingModels.length === 0}
            onChange={(event) => setForm((current) => ({ ...current, modelId: event.target.value }))}
          >
            {codingModels.map((model) => (
              <option key={model.id} value={model.id}>{model.label}</option>
            ))}
          </select>
        </label>
        <label className="plan-promotion-field" title="Reasoning effort used while coding">
          <span className="plan-promotion-label">Coding effort</span>
          <OptionList
            value={form.effortLevel}
            options={EFFORT_OPTION_ITEMS}
            onChange={(id) => setForm((prev) => ({ ...prev, effortLevel: id }))}
            label="Coding effort"
          />
        </label>
        <label className="plan-promotion-field" title="Skill">
          <span className="plan-promotion-label">Skill</span>
          {skillsFailed ? (
            <input
              className="input plan-promotion-input"
              type="text"
              title="Skill"
              placeholder="Skill"
              value={form.skillId}
              onChange={(e) => setForm((prev) => ({ ...prev, skillId: e.target.value }))}
            />
          ) : (
            <div className="skill-picker" ref={skillPickerRef}>
              <button
                className="skill-picker-trigger"
                type="button"
                title={form.skillId ? `Selected skill: ${form.skillId}` : "No skill selected"}
                onClick={() => setSkillMenuOpen((v) => !v)}
              >
                {form.skillId || "No skill"}
              </button>
              {skillMenuOpen ? (
                <div className="skill-picker-menu">
                  <button
                    className={`skill-picker-item${form.skillId === "" ? " is-active" : ""}`}
                    type="button"
                    title="No skill"
                    onClick={() => {
                      setForm((prev) => ({ ...prev, skillId: "" }));
                      setSkillMenuOpen(false);
                    }}
                  >
                    No skill
                  </button>
                  {resolvedSkills.map((skill) => (
                    <button
                      key={skill.name}
                      className={`skill-picker-item${form.skillId === skill.name ? " is-active" : ""}`}
                      type="button"
                      title={skill.description}
                      onClick={() => {
                        setForm((prev) => ({ ...prev, skillId: skill.name }));
                        setSkillMenuOpen(false);
                      }}
                    >
                      {skill.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
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
          <OptionList
            value={form.workspacePolicy}
            options={WORKSPACE_OPTION_ITEMS}
            onChange={(id) => setForm((prev) => ({ ...prev, workspacePolicy: id }))}
            label="Workspace policy"
          />
        </label>
        <label className="plan-promotion-field" title="Scheduling mode">
          <span className="plan-promotion-label">Scheduling</span>
          <OptionList
            value={form.schedulingMode}
            options={SCHEDULING_OPTION_ITEMS}
            onChange={(id) => setForm((prev) => ({ ...prev, schedulingMode: id }))}
            label="Scheduling mode"
          />
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
        {runtimeReady ? null : (
          <div className="plan-runtime-blocked" title="OpenSpec runtime not ready">
            <AlertCircle size={12} />
            <span className="text-sm">
              OpenSpec runtime is {runtime.status?.state ?? "missing"}.{" "}
              Configure it in Settings → OpenSpec before generating or approving.
            </span>
          </div>
        )}
        {plan.status === "draft" ? (
          <button
            className="btn btn-sm btn-primary"
            type="button"
            title={runtimeReady ? "Generate proposal, specs, design, and tasks with the planner model" : "OpenSpec runtime not configured"}
            disabled={loading || !runtimeReady || !plannerProviderId || !plannerModelId}
            onClick={() => void handleGenerateOpenSpec()}
          >
            {loading ? <RefreshCw size={11} className="is-spinning" /> : <Rocket size={11} />}
            {loading ? "Generating OpenSpec..." : "Generate OpenSpec"}
          </button>
        ) : (
          <button
            className="btn btn-sm btn-primary"
            type="button"
            title={runtimeReady ? "Validate the generated artifacts and approve this plan for the queue" : "OpenSpec runtime not configured"}
            disabled={loading || hasErrors || !runtimeReady}
            onClick={() => void handlePromote()}
          >
            {loading ? <RefreshCw size={11} className="is-spinning" /> : <CheckCircle size={11} />}
            {loading ? "Validating..." : "Approve plan"}
          </button>
        )}
        {plan.status === "openspec" && validation ? (
          <button
            className="btn btn-sm"
            type="button"
            title="Re-validate the generated OpenSpec artifacts"
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
