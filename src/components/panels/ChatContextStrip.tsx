import { useCallback, useEffect, useState } from "react";
import { GitBranch, Box, ListChecks, Cpu, Gauge } from "lucide-react";
import { openspecTaskProgress } from "../../lib/openspec";

export type ChatContextStripProps = {
  projectPath: string | null;
  workspaceId: string | null;
  branch: string | null;
  worktreePath: string | null;
  plan: { referenceId: string; title: string; status: string; changeName?: string } | null;
  runState: "idle" | "queued" | "running" | "blocked" | "finished" | "failed";
  modelLabel: string;
  contextUsage: { used: number | null; limit: number | null };
};

type RunStateConfig = {
  label: string;
  className: string;
};

const RUN_STATE_CONFIG: Record<string, RunStateConfig> = {
  idle: { label: "idle", className: "is-idle" },
  queued: { label: "queued", className: "is-queued" },
  running: { label: "running", className: "is-running" },
  blocked: { label: "blocked", className: "is-blocked" },
  finished: { label: "finished", className: "is-finished" },
  failed: { label: "failed", className: "is-failed" },
};

function ContextChip({
  icon,
  label,
  value,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <span className="chat-context-chip" title={title ?? `${label}: ${value}`}>
      {icon}
      <span className="chat-context-chip-label">{label}</span>
      <span className="chat-context-chip-value">{value}</span>
    </span>
  );
}

function ContextMeter({ used, limit }: { used: number | null; limit: number | null }) {
  let pct: number | null = null;
  let state: "healthy" | "warning" | "critical" | "unknown" = "unknown";
  if (used != null && limit != null && limit > 0) {
    pct = Math.min(100, (used / limit) * 100);
    state = pct < 60 ? "healthy" : pct < 85 ? "warning" : "critical";
  }
  const label =
    used != null && limit != null
      ? `${Math.round(used / 1000)}k/${Math.round(limit / 1000)}k`
      : used != null
        ? `${Math.round(used / 1000)}k`
        : "unknown";
  return (
    <span
      className={`chat-context-meter is-${state}`}
      title={`Context window: ${label}${pct != null ? ` (${Math.round(pct)}%)` : ""}`}
    >
      <Gauge size={11} />
      <span className="chat-context-chip-label">ctx</span>
      <span className="chat-context-chip-value">{label}</span>
      {pct != null ? (
        <span className="chat-context-meter-bar">
          <span
            className={`chat-context-meter-fill is-${state}`}
            style={{ width: `${pct}%` }}
          />
        </span>
      ) : null}
    </span>
  );
}

export function ChatContextStrip(props: ChatContextStripProps) {
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);

  const refreshProgress = useCallback(async () => {
    if (!props.projectPath || !props.plan?.changeName) {
      setProgress(null);
      return;
    }
    try {
      const result = await openspecTaskProgress(
        props.projectPath,
        props.plan.changeName,
      );
      if (result.total > 0) setProgress({ completed: result.completed, total: result.total });
      else setProgress(null);
    } catch {
      setProgress(null);
    }
  }, [props.projectPath, props.plan?.changeName]);

  useEffect(() => {
    void refreshProgress();
    if (!props.plan || props.runState !== "running") return;
    const interval = setInterval(() => void refreshProgress(), 5000);
    return () => clearInterval(interval);
  }, [refreshProgress, props.plan, props.runState]);

  const runCfg = RUN_STATE_CONFIG[props.runState] ?? RUN_STATE_CONFIG.idle;
  const modelLabel = props.modelLabel || "no model";

  return (
    <div className="chat-context-strip" title="Chat workspace and plan context">
      {props.branch ? (
        <ContextChip
          icon={<GitBranch size={11} />}
          label="branch"
          value={props.branch}
          title={`Branch: ${props.branch}`}
        />
      ) : null}
      {props.worktreePath ? (
        <ContextChip
          icon={<Box size={11} />}
          label="worktree"
          value="isolated"
          title={`Worktree path: ${props.worktreePath}`}
        />
      ) : null}
      {props.workspaceId ? (
        <ContextChip
          icon={<Box size={11} />}
          label="ws"
          value={props.workspaceId}
          title={`Workspace: ${props.workspaceId}`}
        />
      ) : null}
      {props.plan ? (
        <ContextChip
          icon={<ListChecks size={11} />}
          label="plan"
          value={`${props.plan.referenceId} ${props.plan.status}`}
          title={`Plan: ${props.plan.title} (${props.plan.status})`}
        />
      ) : null}
      {progress ? (
        <ContextChip
          icon={<ListChecks size={11} />}
          label="tasks"
          value={`${progress.completed}/${progress.total}`}
          title={`Task progress: ${progress.completed}/${progress.total}`}
        />
      ) : null}
      <ContextChip
        icon={<Cpu size={11} />}
        label="model"
        value={modelLabel}
        title={`Model: ${modelLabel}`}
      />
      <span
        className={`chat-context-run-state ${runCfg.className}`}
        title={`Run state: ${runCfg.label}`}
      >
        {runCfg.label}
      </span>
      <ContextMeter used={props.contextUsage.used} limit={props.contextUsage.limit} />
    </div>
  );
}
