import { useState } from "react";
import {
  resolveToolApproval,
  type NativeToolEvent,
  type SubagentPendingApproval,
  type SubagentRun,
} from "../../../lib/native-chat";
import { useLogs } from "../../../state/log";

type Decision = "allow" | "allow_session" | "deny";

/** Child statuses that have stopped running. Anything else is still in flight. */
const TERMINAL_TONE: Record<string, string> = {
  completed: "success",
  failed: "error",
  cancelled: "error",
};

function describeApproval(approval: SubagentPendingApproval): string {
  const text = approval.command ?? approval.arguments;
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

/**
 * Card for a `task` tool event. Shows one row per subagent with its status,
 * live activity, approval prompts, and final report. Child approvals are
 * answered here because they are not chat-level approval requests.
 */
export function SubagentTaskCard({ event }: { event: NativeToolEvent }) {
  const { addLog } = useLogs();
  const [expanded, setExpanded] = useState(true);
  const runs: SubagentRun[] = event.subagents ?? [];
  const doneCount = runs.filter((run) => TERMINAL_TONE[run.status] !== undefined).length;
  const waitingCount = runs.filter((run) => run.pendingApproval).length;
  const cardTone =
    event.status === "error" || event.status === "denied"
      ? "error"
      : event.status === "success"
        ? "success"
        : "running";
  const summary =
    runs.length === 0
      ? "Starting subagents"
      : `${doneCount}/${runs.length} done${waitingCount > 0 ? `, ${waitingCount} awaiting approval` : ""}`;

  const toggle = () => {
    addLog("debug", "Subagent card toggled", `${event.id}: ${expanded ? "collapsed" : "expanded"}`);
    setExpanded((prev) => !prev);
  };

  const answer = async (run: SubagentRun, decision: Decision) => {
    const approval = run.pendingApproval;
    if (!approval) return;
    addLog("debug", "Subagent approval answered", `${run.name}: ${decision} for ${approval.toolName}`);
    try {
      await resolveToolApproval(approval.toolCallId, decision);
    } catch (error) {
      addLog("error", "Subagent approval failed", error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className={`tool-card subagent-task-card tool-card-${cardTone}`}>
      <button
        className="tool-card-header subagent-task-toggle"
        type="button"
        title={expanded ? "Collapse subagents" : "Expand subagents"}
        onClick={toggle}
      >
        <span className="tool-card-name">task</span>
        <span className="tool-card-summary-inline">{summary}</span>
        <span className={`tool-card-status tool-card-status-${cardTone}`}>{event.status}</span>
      </button>
      {expanded ? (
        <div className="tool-card-body">
          {runs.length === 0 ? (
            <div className="chat-loading">Starting subagents...</div>
          ) : (
            <ol className="subagent-list">
              {runs.map((run) => (
                <li
                  key={run.index}
                  className={`subagent-row subagent-${run.status}`}
                  title={`${run.index}. ${run.name}: ${run.status}`}
                >
                  <div className="subagent-row-head">
                    <span className="subagent-index">{run.index}.</span>
                    <span className="subagent-name">{run.name}</span>
                    <span className={`tool-card-status tool-card-status-${TERMINAL_TONE[run.status] ?? "running"}`}>
                      {run.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  {run.activity ? (
                    <div className="subagent-activity" title="Latest step">
                      {run.activity}
                    </div>
                  ) : null}
                  {run.pendingApproval ? (
                    <div className="tool-card-actions tool-card-approval-actions subagent-approval">
                      <code
                        className="subagent-approval-call"
                        title={`Tool call: ${run.pendingApproval.toolName}`}
                      >
                        {run.pendingApproval.toolName}: {describeApproval(run.pendingApproval)}
                      </code>
                      <button
                        className="btn btn-sm btn-primary"
                        type="button"
                        title="Allow this tool call once"
                        onClick={() => void answer(run, "allow")}
                      >
                        Allow Once
                      </button>
                      <button
                        className="btn btn-sm"
                        type="button"
                        title="Allow all calls to this tool for this session"
                        onClick={() => void answer(run, "allow_session")}
                      >
                        Allow Session
                      </button>
                      <button
                        className="btn btn-sm"
                        type="button"
                        title="Deny this tool call"
                        onClick={() => void answer(run, "deny")}
                      >
                        Deny
                      </button>
                    </div>
                  ) : null}
                  {run.result ? (
                    <details className="subagent-report" title="Final report from this subagent">
                      <summary title="Show the final report">Report</summary>
                      <pre className="tool-card-summary">{run.result}</pre>
                    </details>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
}
