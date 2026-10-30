import { Plus, Sparkles, Wrench, Rocket, CheckCircle, GitMerge, Archive } from "lucide-react";
import { t } from "../../i18n";

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
  onReviewIdeas: () => void;
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
      label: t("planningCommandCenter.ideas"),
      count: props.ideas,
      status: stageStatus(props.ideas, false, false),
      actionLabel: t("planningCommandCenter.generateMore"),
    },
    {
      id: "openspec",
      label: t("planningCommandCenter.openspec"),
      count: props.openspec,
      status: stageStatus(props.openspec, false, false),
      actionLabel: t("planningCommandCenter.viewDrafts"),
    },
    {
      id: "ready",
      label: t("planningCommandCenter.ready"),
      count: props.ready,
      status: stageStatus(props.ready, false, false),
      actionLabel: t("planningCommandCenter.assignToChat"),
    },
    {
      id: "queued",
      label: t("planningCommandCenter.queued"),
      count: props.queued,
      status: stageStatus(props.queued, false, false),
      actionLabel: t("planningCommandCenter.startQueue"),
    },
    {
      id: "running",
      label: t("planningCommandCenter.running"),
      count: props.running,
      status: stageStatus(props.running, props.running > 0, false),
      actionLabel: t("planningCommandCenter.viewRuns"),
    },
    {
      id: "blocked",
      label: t("planningCommandCenter.blocked"),
      count: props.blocked,
      status: stageStatus(props.blocked, false, props.blocked > 0),
      actionLabel: t("planningCommandCenter.resolve"),
    },
    {
      id: "review",
      label: t("planningCommandCenter.review2"),
      count: props.review,
      status: stageStatus(props.review, false, false),
      actionLabel: t("planningCommandCenter.reviewNow"),
    },
    {
      id: "finished",
      label: t("planningCommandCenter.finished"),
      count: props.finished,
      status: stageStatus(props.finished, false, false),
      actionLabel: t("planningCommandCenter.archiveSync2"),
    },
  ];

  return (
    <div className="planning-command-center" title={t("planningCommandCenter.planningCommandCenterLiveCounts")}>
      <div className="planning-stage-cards">
        {stages.map((stage) => (
          <button
            key={stage.id}
            type="button"
            className={`planning-stage-card is-${stage.status}`}
            title={t("planningCommandCenter.text", { label: stage.label, count: stage.count, actionLabel: stage.actionLabel })}
            onClick={() => props.onStageClick?.(stage.id)}
          >
            <span className="planning-stage-count">{stage.count}</span>
            <span className="planning-stage-label">{stage.label}</span>
            <span className="planning-stage-action">{stage.actionLabel}</span>
            {stage.status === "active" ? (
              <span className="planning-stage-pulse" title={t("planningCommandCenter.active")} />
            ) : null}
          </button>
        ))}
      </div>
      <div className="planning-command-actions">
        <button
          className="btn btn-sm btn-primary"
          type="button"
          title={t("planningCommandCenter.generateMoreGroundedIdeasFrom")}
          onClick={props.onGenerateIdeas}
        >
          <Plus size={11} /> {t("planningCommandCenter.generateIdeas")}
        </button>
        <button
          className="btn btn-sm"
          type="button"
          title={t("planningCommandCenter.reviewGeneratedIdeasAndApprove")}
          onClick={props.onReviewIdeas}
          disabled={props.ideas === 0}
        >
          <Wrench size={11} /> {t("planningCommandCenter.reviewIdeas")}
        </button>
        <button
          className="btn btn-sm"
          type="button"
          title={t("planningCommandCenter.reviewFinishedRunsAwaitingReview")}
          onClick={props.onReview}
          disabled={props.review === 0}
        >
          <CheckCircle size={11} /> {t("planningCommandCenter.review", { review: props.review })}
        </button>
        <button
          className="btn btn-sm"
          type="button"
          title={t("planningCommandCenter.openTheMergeQueueFor")}
          onClick={props.onMerge}
          disabled={props.finished === 0}
        >
          <GitMerge size={11} /> {t("planningCommandCenter.merge")}
        </button>
        <button
          className="btn btn-sm"
          type="button"
          title={t("planningCommandCenter.archiveOrSyncCompletedOpenspec")}
          onClick={props.onArchiveSync}
          disabled={props.finished === 0}
        >
          <Archive size={11} /> {t("planningCommandCenter.archiveSync")}
        </button>
      </div>
    </div>
  );
}
