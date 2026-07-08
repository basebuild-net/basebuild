import { useEffect, useState } from "react";
import { Activity, FolderTree, Lightbulb, ListChecks, Play, Check } from "lucide-react";

import type { Plan } from "../../lib/plans";

type CommandStripProps = {
  plans: Plan[];
  ideaCount: number;
  schematicHealth: "complete" | "incomplete" | "none";
  onOpenStage: (stage: StageKey) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

export type StageKey = "schematic" | "ideas" | "plans" | "running" | "finished";

const STAGE_META: Record<StageKey, { label: string; icon: typeof Activity }> = {
  schematic: { label: "Schematic", icon: FolderTree },
  ideas: { label: "Ideas", icon: Lightbulb },
  plans: { label: "Plans", icon: ListChecks },
  running: { label: "Running", icon: Play },
  finished: { label: "Done", icon: Check },
};

export function CommandStrip({
  plans,
  ideaCount,
  schematicHealth,
  onOpenStage,
  collapsed,
  onToggleCollapse,
}: CommandStripProps) {
  const [pulse, setPulse] = useState(false);

  const runningCount = plans.filter((p) => p.status === "running").length;
  const finishedCount = plans.filter((p) => p.status === "finished").length;
  const readyCount = plans.filter((p) => p.status === "ready").length;

  // Pulse when running count changes.
  const prevRunningRef = useState({ count: runningCount })[0];
  useEffect(() => {
    if (runningCount !== prevRunningRef.count) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 1000);
      prevRunningRef.count = runningCount;
      return () => clearTimeout(t);
    }
  }, [runningCount, prevRunningRef]);

  const stages: { key: StageKey; count: number; status: "ok" | "warn" | "active" | "empty" }[] = [
    {
      key: "schematic",
      count: schematicHealth === "complete" ? 1 : 0,
      status: schematicHealth === "complete" ? "ok" : schematicHealth === "incomplete" ? "warn" : "empty",
    },
    { key: "ideas", count: ideaCount, status: ideaCount > 0 ? "ok" : "empty" },
    { key: "plans", count: plans.length, status: plans.length > 0 ? "ok" : "empty" },
    { key: "running", count: runningCount, status: runningCount > 0 ? "active" : "empty" },
    { key: "finished", count: finishedCount, status: finishedCount > 0 ? "ok" : "empty" },
  ];

  if (collapsed) {
    return (
      <button
        type="button"
        className="command-strip-collapsed"
        title={`Planning: ${runningCount} running, ${readyCount} ready, ${finishedCount} done`}
        onClick={onToggleCollapse}
      >
        <Activity size={14} className={pulse ? "is-pulsing" : ""} />
        {runningCount > 0 ? <span className="command-strip-badge">{runningCount}</span> : null}
      </button>
    );
  }

  return (
    <div className="command-strip" title="Planning pipeline — click to open Plans & Ideas">
      <button
        type="button"
        className="command-strip-toggle"
        title="Collapse command strip"
        onClick={onToggleCollapse}
      >
        <Activity size={12} className={pulse ? "is-pulsing" : ""} />
      </button>
      {stages.map((stage) => {
        const meta = STAGE_META[stage.key];
        const Icon = meta.icon;
        return (
          <button
            key={stage.key}
            type="button"
            className={`command-strip-stage command-strip-${stage.status}`}
            title={`${meta.label}: ${stage.count}${stage.key === "running" ? " running" : ""}`}
            onClick={() => onOpenStage(stage.key)}
          >
            <Icon size={11} />
            <span className="command-strip-stage-label">{meta.label}</span>
            <span className={`command-strip-stage-count command-strip-count-${stage.status}`}>
              {stage.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
