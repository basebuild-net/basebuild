import { Loader, Lightbulb, Repeat, GitCommit, GitPullRequest, Users, Square } from "lucide-react";

export type AutoMode = "none" | "steps" | "idea" | "combined";

type AutonomousToolbarProps = {
  autoMode: AutoMode;
  autoCommit: boolean;
  autoPr: boolean;
  autoGroupPr: boolean;
  autoAgents: number;
  onModeChange: (mode: AutoMode) => void;
  onCommitChange: (v: boolean) => void;
  onPrChange: (v: boolean) => void;
  onGroupPrChange: (v: boolean) => void;
  onAgentsChange: (n: number) => void;
  onStop?: () => void;
};

const MODE_LABELS: Record<AutoMode, string> = {
  none: "Manual",
  steps: "Continue",
  idea: "Ideation",
  combined: "Full Cycle",
};

const MODE_ICONS: Record<AutoMode, typeof Loader> = {
  none: Loader,
  steps: Repeat,
  idea: Lightbulb,
  combined: Repeat,
};

export function AutonomousToolbar({
  autoMode,
  autoCommit,
  autoPr,
  autoGroupPr,
  autoAgents,
  onModeChange,
  onCommitChange,
  onPrChange,
  onGroupPrChange,
  onAgentsChange,
  onStop,
}: AutonomousToolbarProps) {
  const ModeIcon = MODE_ICONS[autoMode];
  const isActive = autoMode !== "none";

  return (
    <div className="autonomous-toolbar">
      {/* Mode selector: cycles none -> steps -> idea -> combined -> none */}
      <button
        className={`auto-mode-btn${isActive ? " is-active" : ""}`}
        title={`Autonomous mode: ${MODE_LABELS[autoMode]}`}
        type="button"
        onClick={() => {
          const order: AutoMode[] = ["none", "steps", "idea", "combined"];
          const next = order[(order.indexOf(autoMode) + 1) % order.length];
          onModeChange(next);
        }}
      >
        <ModeIcon size={13} />
        <span>{MODE_LABELS[autoMode]}</span>
      </button>

      {isActive && (
        <>
          <span className="auto-sep" />

          {/* Publishing toggles */}
          <button
            className={`auto-toggle${autoCommit ? " is-active" : ""}`}
            title="Auto-commit verified work"
            type="button"
            onClick={() => onCommitChange(!autoCommit)}
          >
            <GitCommit size={12} />
          </button>

          <button
            className={`auto-toggle${autoPr ? " is-active" : ""}`}
            title="Auto-PR: create pull request for each work unit"
            type="button"
            onClick={() => onPrChange(!autoPr)}
          >
            <GitPullRequest size={12} />
          </button>

          <button
            className={`auto-toggle${autoGroupPr ? " is-active" : ""}`}
            title="Group PR: one shared PR for the autonomous run"
            type="button"
            onClick={() => onGroupPrChange(!autoGroupPr)}
          >
            <GitPullRequest size={12} />
            <span className="auto-toggle-label">G</span>
          </button>

          {/* Subagent count */}
          <label className="auto-agents" title="Number of subagents to spawn per work unit">
            <Users size={12} />
            <input
              type="number"
              min={0}
              max={10}
              value={autoAgents}
              onChange={(e) => onAgentsChange(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
            />
          </label>

          {/* Stop button */}
          {onStop && (
            <>
              <span className="auto-sep" />
              <button
                className="auto-stop"
                title="Stop autonomous mode (interrupts current turn)"
                type="button"
                onClick={onStop}
              >
                <Square size={12} />
                Stop
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
