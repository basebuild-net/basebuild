import { useCallback, useEffect, useState } from "react";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { Copy, ListChecks, Loader2, MessageSquare, TerminalSquare, X } from "lucide-react";
import type { Plan, PlanFocusContext } from "../../lib/plans";
import { PLAN_STATUS_LABEL } from "../../lib/plans";
import { openspecReadTasksStructured, openspecToggleTask, type StructuredTasks } from "../../lib/openspec";
import { ModalPortal } from "../ModalPortal";
type FocusPlanModalProps = {
  plan: Plan | null;
  open: boolean;
  projectPath: string;
  onClose: () => void;
  onCopyReference: (refId: string) => void;
  onOpenInTerminal: (plan: Plan) => void;
  onSetContext: (id: string, context: PlanFocusContext) => void;
  /** Open the chat session hosting this plan's active run. */
  onOpenRunChat?: (plan: Plan) => void;
};

export function FocusPlanModal({
  plan,
  open,
  projectPath,
  onClose,
  onCopyReference,
  onOpenInTerminal,
  onSetContext,
  onOpenRunChat,
}: FocusPlanModalProps) {
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState("");
  const [terminalTail, setTerminalTail] = useState("");
  useEscapeKey(open, onClose);
  const [tasks, setTasks] = useState<StructuredTasks | null>(null);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [togglingLine, setTogglingLine] = useState<number | null>(null);

  const changeName = plan?.changeName ?? null;
  const isRunning = plan?.status === "running";

  const loadTasks = useCallback(async () => {
    if (!changeName) {
      setTasks(null);
      return;
    }
    try {
      setTasks(await openspecReadTasksStructured(projectPath, changeName));
    } catch {
      setTasks(null);
    }
  }, [projectPath, changeName]);

  useEffect(() => {
    if (!plan || !open) {
      setTasks(null);
      return;
    }
    setNotes(plan.context?.notes ?? "");
    setTasksLoading(true);
    void loadTasks().finally(() => setTasksLoading(false));
  }, [plan, open, loadTasks]);

  // Live progress: poll tasks.md while an agent works the plan.
  useEffect(() => {
    if (!open || !isRunning || !changeName) return;
    const poll = setInterval(() => void loadTasks(), 4000);
    return () => clearInterval(poll);
  }, [open, isRunning, changeName, loadTasks]);

  const handleToggleTask = useCallback(
    async (line: number, makeChecked: boolean) => {
      if (!changeName) return;
      setTogglingLine(line);
      try {
        await openspecToggleTask(projectPath, changeName, line, makeChecked);
        await loadTasks();
      } catch {
        // Reload anyway so the checkbox reflects the file's real state.
        await loadTasks();
      } finally {
        setTogglingLine(null);
      }
    },
    [projectPath, changeName, loadTasks],
  );

  if (!open || !plan) return null;
  const currentPlan = plan;


  const remaining = tasks ? tasks.total - tasks.completed : 0;
  const pct = tasks && tasks.total > 0 ? Math.round((tasks.completed / tasks.total) * 100) : 0;

  function handleSaveContext() {
    onSetContext(currentPlan.id, {
      notes,
      files: files
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean),
      terminalOutputTail: terminalTail.trim() || undefined,
    });
  }

  return (
    <ModalPortal>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal plan-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {plan.referenceId} <span className="text-muted">-</span> {plan.title}
          </h3>
          <button className="btn-icon" type="button" title="Close" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body stack focus-plan-body">
          <div className="card stack-sm focus-plan-status-card">
            <span className="text-sm text-muted">Status</span>
            <span className="pill">{PLAN_STATUS_LABEL[plan.status]}</span>
            {isRunning && onOpenRunChat ? (
              <button
                className="btn btn-sm"
                type="button"
                title="Open the chat where the agent is working this plan"
                onClick={() => {
                  onOpenRunChat(currentPlan);
                  onClose();
                }}
              >
                <MessageSquare size={12} /> Open run chat
              </button>
            ) : null}
          </div>
          <div className="card stack-sm">
            <span className="text-sm text-muted">Description</span>
            <p>{plan.description}</p>
            {plan.goal ? <p className="text-sm text-muted">Goal: {plan.goal}</p> : null}
          </div>

          {changeName ? (
            <div className="card stack-sm focus-plan-tasks">
              <div className="focus-plan-tasks-header">
                <span className="text-sm text-muted focus-plan-tasks-title">
                  <ListChecks size={12} /> OpenSpec tasks
                </span>
                {tasks && tasks.total > 0 ? (
                  <span
                    className="text-sm focus-plan-tasks-count"
                    title={`${tasks.completed} of ${tasks.total} tasks done — ${remaining} left`}
                  >
                    {tasks.completed}/{tasks.total} done · {remaining} left
                  </span>
                ) : null}
                {isRunning ? <Loader2 size={11} className="is-spinning text-muted" /> : null}
              </div>
              {tasks && tasks.total > 0 ? (
                <div
                  className="focus-plan-progress"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  title={`${pct}% complete`}
                >
                  <span className="focus-plan-progress-fill" style={{ width: `${pct}%` }} />
                </div>
              ) : null}
              {tasksLoading && !tasks ? (
                <p className="text-sm text-muted">Loading tasks…</p>
              ) : !tasks || tasks.total === 0 ? (
                <p className="text-sm text-muted">
                  No tasks found in this change's tasks.md yet.
                </p>
              ) : (
                <div className="focus-plan-phases">
                  {tasks.phases.map((phase) => {
                    const done = phase.tasks.filter((t) => t.checked).length;
                    return (
                      <div key={`${phase.line}-${phase.name}`} className="focus-plan-phase">
                        <div className="focus-plan-phase-header" title={`${done}/${phase.tasks.length} tasks in this phase`}>
                          <span className="focus-plan-phase-name">{phase.name}</span>
                          <span className={`focus-plan-phase-count${done === phase.tasks.length && phase.tasks.length > 0 ? " is-done" : ""}`}>
                            {done}/{phase.tasks.length}
                          </span>
                        </div>
                        <ul className="focus-plan-task-list">
                          {phase.tasks.map((task) => (
                            <li key={task.line} className={`focus-plan-task${task.checked ? " is-checked" : ""}`}>
                              <label title={task.checked ? "Mark task as not done" : "Mark task as done"}>
                                <input
                                  type="checkbox"
                                  checked={task.checked}
                                  disabled={togglingLine === task.line}
                                  onChange={(e) => void handleToggleTask(task.line, e.target.checked)}
                                />
                                <span className="focus-plan-task-text">
                                  {task.id ? <code className="focus-plan-task-id">{task.id}</code> : null}
                                  {task.text}
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : plan.status !== "draft" ? (
            <div className="card stack-sm">
              <span className="text-sm text-muted">OpenSpec tasks</span>
              <p className="text-sm text-muted">
                No OpenSpec change linked yet — generate the plan's artifacts to get phases and tasks here.
              </p>
            </div>
          ) : null}

          <label className="stack-sm">
            <span className="text-sm text-muted">Focus notes</span>
            <textarea
              className="input pre"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Context, decisions, blockers…"
            />
          </label>
          <label className="stack-sm">
            <span className="text-sm text-muted">Relevant files (one per line)</span>
            <textarea
              className="input pre"
              value={files}
              onChange={(e) => setFiles(e.target.value)}
              rows={2}
            />
          </label>
          <label className="stack-sm">
            <span className="text-sm text-muted">Terminal output tail</span>
            <textarea
              className="input pre"
              value={terminalTail}
              onChange={(e) => setTerminalTail(e.target.value)}
              rows={2}
            />
          </label>

          <div className="focus-plan-lifecycle-note text-sm text-muted">
            Plan lifecycle changes are driven by OpenSpec approval and live runs. Use Plans to approve or assign work, and Runs to resume or review execution.
          </div>
        </div>
        <div className="modal-actions">
          <button
            className="btn"
            type="button"
            onClick={() => {
              handleSaveContext();
              onClose();
            }}
          >
            Save context
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              handleSaveContext();
              onCopyReference(currentPlan.referenceId);
            }}
          >
            <Copy size={12} /> Copy ref
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              handleSaveContext();
              onOpenInTerminal(currentPlan);
            }}
          >
            <TerminalSquare size={12} /> Open in terminal
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
