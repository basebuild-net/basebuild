import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  FolderTree,
  Lightbulb,
  ListChecks,
  Play,
  Square,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { Idea } from "../../lib/ideas";
import type { Plan } from "../../lib/plans";

export type StageKey = "schematic" | "ideas" | "plans" | "running" | "finished";

type StageMeta = {
  label: string;
  icon: LucideIcon;
  /** CSS color variable name from --bb-* palette. */
  color: string;
};

const STAGE_META: Record<StageKey, StageMeta> = {
  schematic: { label: "Schematic", icon: FolderTree, color: "var(--bb-cta)" },
  ideas: { label: "Ideas", icon: Lightbulb, color: "var(--bb-text)" },
  plans: { label: "Plans", icon: ListChecks, color: "var(--bb-warning, #f59e0b)" },
  running: { label: "Running", icon: Play, color: "var(--bb-status-running, #f97316)" },
  finished: { label: "Done", icon: Check, color: "var(--bb-positive, #4ade80)" },
};

type PlanningIndicatorsProps = {
  plans: Plan[];
  ideas: Idea[];
  schematicHealth: "complete" | "incomplete" | "none";
  onOpenStage: (stage: StageKey) => void;
  onOpenFullUI: (stage: StageKey) => void;
  onMarkComplete: (planId: string) => void;
};

type DropdownState = { stage: StageKey; rect: DOMRect } | null;

export function PlanningIndicators({
  plans,
  ideas,
  schematicHealth,
  onOpenStage,
  onOpenFullUI,
  onMarkComplete,
}: PlanningIndicatorsProps) {
  const [dropdown, setDropdown] = useState<DropdownState>(null);
  const [pulse, setPulse] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevRunningRef = useRef(0);

  const runningCount = plans.filter((p) => p.status === "running").length;
  const finishedCount = plans.filter((p) => p.status === "finished").length;
  const ideaCount = ideas.filter((i) => i.status === "concept" || i.status === "picked").length;

  useEffect(() => {
    if (runningCount !== prevRunningRef.current) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 1000);
      prevRunningRef.current = runningCount;
      return () => clearTimeout(t);
    }
  }, [runningCount]);

  const stages: { key: StageKey; count: number }[] = [
    { key: "schematic", count: schematicHealth === "complete" ? 1 : 0 },
    { key: "ideas", count: ideaCount },
    { key: "plans", count: plans.length },
    { key: "running", count: runningCount },
    { key: "finished", count: finishedCount },
  ];

  const closeDropdown = useCallback(() => setDropdown(null), []);

  useEffect(() => {
    if (!dropdown) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el && containerRef.current?.contains(el)) return;
      closeDropdown();
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") closeDropdown(); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [dropdown, closeDropdown]);

  const toggleDropdown = useCallback((stage: StageKey, e: React.MouseEvent) => {
    const btn = e.currentTarget as HTMLElement;
    setDropdown((prev) =>
      prev?.stage === stage ? null : { stage, rect: btn.getBoundingClientRect() },
    );
  }, []);

  return (
    <div className="planning-indicators" ref={containerRef}>
      {stages.map((stage) => {
        const meta = STAGE_META[stage.key];
        const Icon = meta.icon;
        const isPulsing = stage.key === "running" && pulse && stage.count > 0;
        const isOpen = dropdown?.stage === stage.key;
        return (
          <button
            key={stage.key}
            type="button"
            className={`planning-indicator${isOpen ? " is-open" : ""}${isPulsing ? " is-pulsing" : ""}`}
            data-stage={stage.key}
            title={`${meta.label}: ${stage.count}${stage.key === "running" ? " running" : ""}${stage.key === "schematic" ? (schematicHealth === "complete" ? " (complete)" : schematicHealth === "incomplete" ? " (partial)" : " (missing)") : ""}`}
            onClick={(e) => toggleDropdown(stage.key, e)}
          >
            <Icon size={12} className="planning-indicator-icon" />
            <span className="planning-indicator-count">{stage.count}</span>
          </button>
        );
      })}
      {dropdown ? (
        <NotificationDropdown
          stage={dropdown.stage}
          rect={dropdown.rect}
          plans={plans}
          ideas={ideas}
          schematicHealth={schematicHealth}
          onOpenFullUI={() => { onOpenFullUI(dropdown.stage); closeDropdown(); }}
          onMarkComplete={(planId) => { onMarkComplete(planId); }}
          onOpenStage={(stage) => { onOpenStage(stage); closeDropdown(); }}
        />
      ) : null}
    </div>
  );
}

// ─── Notification Dropdown ──────────────────────────────────────────────────

type DropdownProps = {
  stage: StageKey;
  rect: DOMRect;
  plans: Plan[];
  ideas: Idea[];
  schematicHealth: "complete" | "incomplete" | "none";
  onOpenFullUI: () => void;
  onMarkComplete: (planId: string) => void;
  onOpenStage: (stage: StageKey) => void;
};

function NotificationDropdown({
  stage,
  rect,
  plans,
  ideas,
  schematicHealth,
  onOpenFullUI,
  onMarkComplete,
  onOpenStage,
}: DropdownProps) {
  const meta = STAGE_META[stage];
  const Icon = meta.icon;

  // Position dropdown below the button, clamped to viewport.
  const top = rect.bottom + 4;
  const left = Math.min(rect.left, window.innerWidth - 280);

  return (
    <div
      className="planning-notification-dropdown"
      data-stage={stage}
      style={{ top: `${top}px`, left: `${left}px` }}
    >
      <div className="planning-notification-header">
        <Icon size={11} className="planning-notification-header-icon" />
        <span className="planning-notification-title">{meta.label}</span>
        <button
          type="button"
          className="planning-notification-full-btn"
          title={`Open full ${meta.label} UI`}
          onClick={onOpenFullUI}
        >
          Full UI
          <ChevronRight size={10} />
        </button>
      </div>
      <div className="planning-notification-list">
        {stage === "schematic" ? (
          <SchematicItems health={schematicHealth} onOpen={onOpenStage} />
        ) : stage === "ideas" ? (
          <IdeaItems ideas={ideas} />
        ) : stage === "plans" ? (
          <PlanItems plans={plans} filter={(p) => p.status !== "running" && p.status !== "finished"} />
        ) : stage === "running" ? (
          <PlanItems plans={plans} filter={(p) => p.status === "running"} />
        ) : stage === "finished" ? (
          <FinishedItems plans={plans} onMarkComplete={onMarkComplete} />
        ) : null}
      </div>
    </div>
  );
}

// ─── Schematic items ────────────────────────────────────────────────────────

function SchematicItems({
  health,
  onOpen,
}: {
  health: "complete" | "incomplete" | "none";
  onOpen: (stage: StageKey) => void;
}) {
  const label = health === "complete" ? "Schematic complete" : health === "incomplete" ? "Schematic partial" : "No schematic";
  return (
    <button
      type="button"
      className="planning-notification-item"
      data-health={health}
      title="Open schematic editor"
      onClick={() => onOpen("schematic")}
    >
      <span className="planning-notification-item-dot" />
      <span className="planning-notification-item-text">{label}</span>
    </button>
  );
}

// ─── Idea items ─────────────────────────────────────────────────────────────

function IdeaItems({ ideas }: { ideas: Idea[] }) {
  const active = ideas.filter((i) => i.status === "concept" || i.status === "picked");
  if (active.length === 0) {
    return <div className="planning-notification-empty">No active ideas</div>;
  }
  return (
    <>
      {active.slice(0, 12).map((idea) => (
        <div key={idea.id} className="planning-notification-item" title={idea.description}>
          <span className="planning-notification-item-dot planning-notification-item-dot--ideas" />
          <span className="planning-notification-item-text">{idea.title}</span>
          <span className="planning-notification-item-meta">{idea.status}</span>
        </div>
      ))}
      {active.length > 12 ? (
        <div className="planning-notification-more">+{active.length - 12} more</div>
      ) : null}
    </>
  );
}

// ─── Plan items (generic) ───────────────────────────────────────────────────

function PlanItems({
  plans,
  filter,
}: {
  plans: Plan[];
  filter: (p: Plan) => boolean;
}) {
  const filtered = plans.filter(filter);
  if (filtered.length === 0) {
    return <div className="planning-notification-empty">No items</div>;
  }
  return (
    <>
      {filtered.slice(0, 12).map((plan) => (
        <div key={plan.id} className="planning-notification-item" title={plan.description || plan.goal || ""}>
          <span className="planning-notification-item-dot planning-notification-item-dot--plans" />
          <span className="planning-notification-item-text">#{plan.referenceId} {plan.title}</span>
          <span className="planning-notification-item-meta">{plan.status}</span>
        </div>
      ))}
      {filtered.length > 12 ? (
        <div className="planning-notification-more">+{filtered.length - 12} more</div>
      ) : null}
    </>
  );
}

// ─── Finished items with Mark as Complete ───────────────────────────────────

function FinishedItems({
  plans,
  onMarkComplete,
}: {
  plans: Plan[];
  onMarkComplete: (planId: string) => void;
}) {
  const finished = plans.filter((p) => p.status === "finished");
  const running = plans.filter((p) => p.status === "running");
  if (finished.length === 0 && running.length === 0) {
    return <div className="planning-notification-empty">No finished plans</div>;
  }
  return (
    <>
      {running.map((plan) => (
        <div key={plan.id} className="planning-notification-item planning-notification-item-running" title={plan.description || plan.goal || ""}>
          <span className="planning-notification-item-dot" />
          <span className="planning-notification-item-text">#{plan.referenceId} {plan.title}</span>
          <button
            type="button"
            className="planning-notification-action"
            title="Mark as complete"
            onClick={(e) => { e.stopPropagation(); onMarkComplete(plan.id); }}
          >
            <Check size={10} />
          </button>
        </div>
      ))}
      {finished.map((plan) => (
        <div key={plan.id} className="planning-notification-item planning-notification-item-done" title={plan.description || plan.goal || ""}>
          <span className="planning-notification-item-dot" />
          <span className="planning-notification-item-text">#{plan.referenceId} {plan.title}</span>
          <span className="planning-notification-item-meta">done</span>
        </div>
      ))}
    </>
  );
}
