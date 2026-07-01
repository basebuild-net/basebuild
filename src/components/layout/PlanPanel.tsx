import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import type { Plan, PlanStatus } from "../../lib/plans";
import { PLAN_STATUSES, PLAN_STATUS_LABEL, isTerminalStatus } from "../../lib/plans";

type PlanPanelProps = {
  sessionId: string | null;
  plans: Plan[];
  loading: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onCreatePlan: () => void;
  onGeneratePlans: () => void;
  onEditPlan: (plan: Plan) => void;
  onFocusPlan: (plan: Plan) => void;
  onSetPlanStatus: (id: string, status: PlanStatus) => void;
  onDeletePlan: (id: string) => void;
  onCopyReference: (refId: string) => void;
  onOpenInTerminal: (plan: Plan) => void;
  onEnhancePlan?: (plan: Plan) => void;
  showHeader?: boolean;
};

export function PlanPanel({
  sessionId,
  plans,
  loading,
  collapsed,
  onToggleCollapse,
  onCreatePlan,
  onGeneratePlans,
  onEditPlan,
  onFocusPlan,
  onSetPlanStatus,
  onDeletePlan,
  onCopyReference,
  onOpenInTerminal,
  onEnhancePlan,
  showHeader = true,
}: PlanPanelProps) {
  const [expandedFinished, setExpandedFinished] = useState(false);

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
            title="Generate plans"
            aria-label="Generate plans"
            type="button"
            onClick={onGeneratePlans}
          >
            <Sparkles size={15} />
          </button>
          <button
            className="btn-icon"
            title="Create plan"
            aria-label="Create plan"
            type="button"
            onClick={onCreatePlan}
          >
            <Plus size={15} />
          </button>
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
            title="Generate plans"
            aria-label="Generate plans"
            type="button"
            onClick={onGeneratePlans}
          >
            <Sparkles size={15} />
          </button>
          <button
            className="btn-icon"
            title="Create plan"
            aria-label="Create plan"
            type="button"
            onClick={onCreatePlan}
          >
            <Plus size={15} />
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
            <button className="btn btn-primary btn-sm" type="button" onClick={onGeneratePlans}>
              <Sparkles size={12} /> Generate plans
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
                          onEdit={onEditPlan}
                          onFocus={onFocusPlan}
                          onSetStatus={onSetPlanStatus}
                          onDeletePlan={onDeletePlan}
                          onCopyReference={onCopyReference}
                          onOpenInTerminal={onOpenInTerminal}
                          onEnhancePlan={onEnhancePlan}
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
                      onEdit={onEditPlan}
                      onFocus={onFocusPlan}
                      onSetStatus={onSetPlanStatus}
                      onDeletePlan={onDeletePlan}
                      onCopyReference={onCopyReference}
                      onOpenInTerminal={onOpenInTerminal}
                      onEnhancePlan={onEnhancePlan}
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

type PlanCardProps = {
  plan: Plan;
  onEdit: (plan: Plan) => void;
  onFocus: (plan: Plan) => void;
  onSetStatus: (id: string, status: PlanStatus) => void;
  onDeletePlan: (id: string) => void;
  onCopyReference: (refId: string) => void;
  onOpenInTerminal: (plan: Plan) => void;
  onEnhancePlan?: (plan: Plan) => void;
};

function PlanCard({
  plan,
  onEdit,
  onFocus,
  onSetStatus,
  onDeletePlan,
  onCopyReference,
  onOpenInTerminal,
  onEnhancePlan,
}: PlanCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isFinished = plan.status === "finished";

  const nextStatuses: PlanStatus[] = isFinished
    ? []
    : PLAN_STATUSES.filter((s) => s !== plan.status && !isTerminalStatus(s));

  return (
    <div className={`plan-card${plan.status === "in_progress" ? " is-active" : ""}`}>
      <button
        className="plan-card-main"
        type="button"
        onClick={() => onFocus(plan)}
        title={plan.description}
      >
        <span className="plan-card-ref">{plan.referenceId}</span>
        <span className="plan-card-title">{plan.title}</span>
        {plan.aiEnhanced ? <Sparkles size={10} className="plan-card-ai" /> : null}
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
              {onEnhancePlan && !isFinished ? (
                <button
                  className="menu-item text-sm"
                  type="button"
                  onClick={() => {
                    onEnhancePlan(plan);
                    setMenuOpen(false);
                  }}
                >
                  AI enhance
                </button>
              ) : null}
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
