import { Plus, Sparkles, Wrench, Rocket, UserPlus, CheckCircle, GitMerge, Archive } from "lucide-react";

type StageId = "ideas" | "openspec" | "ready" | "queued" | "running" | "blocked" | "review" | "finished";

type StageStatus = "idle" | "active" | "blocked" | "success" | "warning";

type CommandCenterStage = {
  id: StageId;
  label: string;
  count: number;
  status: StageStatus;
  actionLabel: string;
};

type PlanningCommandCenterProps = {
  ideas: number;
  openspec: number;
  ready: number;
  queued: number;
  running: number;
  blocked: number;
  review: number;
  finished: number;
  onGenerateIdeas: () => void;
  onRunThroughOpenSpec: () => void;
  onAddWorker: () => void;
  onReview: () => void;
  onMerge: () => void;
  onArchiveSync: () => void;
  /** Drill into a stage (e.g. running → mission control). */
  onStageClick?: (stage: StageId) => void;
};

function stageStatus(count: number, active: boolean, blocked: boolean): StageStatus {
  if (blocked) return "blocked";
  if (active) return "active";
  if (count > 0) return "success";
  return "idle";
}

export function PlanningCommandCenter(props: PlanningCommandCenterProps) {
  const stages: CommandCenterStage[] = [
    {
      id: "ideas",
      label: "Ideas",
      count: props.ideas,
      status: stageStatus(props.ideas, false, false),
      actionLabel: "Generate more",
    },
    {
      id: "openspec",
      label: "OpenSpec",
      count: props.openspec,
      status: stageStatus(props.openspec, false, false),
      actionLabel: "View drafts",
    },
    {
      id: "ready",
      label: "Ready",
      count: props.ready,
      status: stageStatus(props.ready, false, false),
      actionLabel: "Assign to chat",
    },
    {
      id: "queued",
      label: "Queued",
      count: props.queued,
      status: stageStatus(props.queued, false, false),
      actionLabel: "Start queue",
    },
    {
      id: "running",
      label: "Running",
      count: props.running,
      status: stageStatus(props.running, props.running > 0, false),
      actionLabel: "View runs",
    },
    {
      id: "blocked",
      label: "Blocked",
      count: props.blocked,
      status: stageStatus(props.blocked, false, props.blocked > 0),
      actionLabel: "Resolve",
    },
    {
      id: "review",
      label: "Review",
      count: props.review,
      status: stageStatus(props.review, false, false),
      actionLabel: "Review now",
    },
    {
      id: "finished",
      label: "Finished",
      count: props.finished,
      status: stageStatus(props.finished, false, false),
      actionLabel: "Archive/Sync",
    },
  ];

  return (
    <div className="planning-command-center" title="Planning command center — live counts and actions">
      <div className="planning-stage-cards">
        {stages.map((stage) => (
          <button
            key={stage.id}
            type="button"
            className={`planning-stage-card is-${stage.status}`}
            title={`${stage.label}: ${stage.count}. ${stage.actionLabel}`}
            onClick={() => props.onStageClick?.(stage.id)}
          >
            <span className="planning-stage-count">{stage.count}</span>
            <span className="planning-stage-label">{stage.label}</span>
            <span className="planning-stage-action">{stage.actionLabel}</span>
            {stage.status === "active" ? (
              <span className="planning-stage-pulse" title="Active" />
            ) : null}
          </button>
        ))}
      </div>
      <div className="planning-command-actions">
        <button
          className="btn btn-sm btn-primary"
          type="button"
          title="Generate more grounded ideas from the project schematic"
          onClick={props.onGenerateIdeas}
        >
          <Plus size={11} /> Generate ideas
        </button>
        <button
          className="btn btn-sm"
          type="button"
          title="Run a selected idea through OpenSpec to generate artifacts"
          onClick={props.onRunThroughOpenSpec}
          disabled={props.ideas === 0}
        >
          <Wrench size={11} /> Run through OpenSpec
        </button>
        <button
          className="btn btn-sm"
          type="button"
          title="Add another worker chat for parallel runs"
          onClick={props.onAddWorker}
        >
          <UserPlus size={11} /> Add worker
        </button>
        <button
          className="btn btn-sm"
          type="button"
          title="Review finished runs awaiting review"
          onClick={props.onReview}
          disabled={props.review === 0}
        >
          <CheckCircle size={11} /> Review ({props.review})
        </button>
        <button
          className="btn btn-sm"
          type="button"
          title="Open the merge queue for finished worktree runs"
          onClick={props.onMerge}
          disabled={props.finished === 0}
        >
          <GitMerge size={11} /> Merge
        </button>
        <button
          className="btn btn-sm"
          type="button"
          title="Archive or sync completed OpenSpec changes"
          onClick={props.onArchiveSync}
          disabled={props.finished === 0}
        >
          <Archive size={11} /> Archive/Sync
        </button>
      </div>
    </div>
  );
}
