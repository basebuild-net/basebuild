import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../layout/ConfirmDialog";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FolderTree,
  Link2,
  RefreshCw,
  Unlink,
} from "lucide-react";

import type { ChangeCatalogEntry, StructuredTasks, TaskPhase } from "../../lib/openspec";
import {
  openspecArchiveChange,
  openspecLinkChangeToPlan,
  openspecListChanges,
  openspecReadTasksStructured,
  openspecRefreshTaskProgress,
  openspecToggleTask,
  openspecUnlinkPlanFromChange,
} from "../../lib/openspec";

type ChangesPanelProps = {
  projectPath: string | null;
  /** Optional callback to focus the plan linked to a change. */
  onFocusPlan?: (referenceId: string) => void;
  /** Plans available for linking (planId → referenceId). */
  linkablePlans?: { id: string; referenceId: string; title: string; status: string }[];
};

type ArchivedFilter = "active" | "archived" | "all";

const POLL_INTERVAL_MS = 5_000;

export function ChangesPanel({ projectPath, onFocusPlan, linkablePlans }: ChangesPanelProps) {
  const [changes, setChanges] = useState<ChangeCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [tasksByChange, setTasksByChange] = useState<Map<string, StructuredTasks>>(new Map());
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [archivedFilter, setArchivedFilter] = useState<ArchivedFilter>("active");
  const [linkingChange, setLinkingChange] = useState<string | null>(null);
  const lastProgressRef = useRef<Map<string, { completed: number; total: number }>>(new Map());
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    destructive: boolean;
    onConfirm: () => void;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setError(null);
    try {
      const list = await openspecListChanges(projectPath);
      setChanges(list);
      // Update last-known progress for polling.
      for (const entry of list) {
        lastProgressRef.current.set(entry.name, { completed: entry.completed, total: entry.total });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 5s mtime-gated poll while the catalog surface is open.
  useEffect(() => {
    if (!projectPath) return;
    const interval = setInterval(async () => {
      for (const entry of changes) {
        if (entry.archived || !entry.hasTasks) continue;
        const last = lastProgressRef.current.get(entry.name) ?? { completed: 0, total: 0 };
        try {
          const changed = await openspecRefreshTaskProgress(
            projectPath,
            entry.name,
            last.completed,
            last.total,
          );
          if (changed) {
            // Refresh the full catalog + tasks if this change is expanded.
            void refresh();
            if (expandedName === entry.name) {
              void loadTasks(entry.name);
            }
          }
        } catch {
          // Silently skip poll errors — the user can manually refresh.
        }
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [projectPath, changes, expandedName, refresh]);

  const loadTasks = useCallback(
    async (changeName: string) => {
      if (!projectPath) return;
      setTasksLoading(true);
      setTasksError(null);
      try {
        const tasks = await openspecReadTasksStructured(projectPath, changeName);
        setTasksByChange((prev) => {
          const next = new Map(prev);
          next.set(changeName, tasks);
          return next;
        });
      } catch (e) {
        setTasksError(e instanceof Error ? e.message : String(e));
      } finally {
        setTasksLoading(false);
      }
    },
    [projectPath],
  );

  const handleExpand = useCallback(
    (changeName: string) => {
      setExpandedName((prev) => {
        if (prev === changeName) return null;
        if (!tasksByChange.has(changeName)) {
          void loadTasks(changeName);
        }
        return changeName;
      });
    },
    [tasksByChange, loadTasks],
  );

  const handleToggleTask = useCallback(
    async (changeName: string, line: number, currentChecked: boolean) => {
      if (!projectPath) return;
      const makeChecked = !currentChecked;
      try {
        await openspecToggleTask(projectPath, changeName, line, makeChecked);
        await loadTasks(changeName);
        void refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [projectPath, loadTasks, refresh],
  );
  const handleArchive = useCallback(
    (changeName: string) => {
      if (!projectPath) return;
      setConfirm({
        title: "Archive change",
        message: `Archive change "${changeName}"? This moves it to openspec/changes/archive/.`,
        confirmLabel: "Archive",
        destructive: true,
        onConfirm: async () => {
          setConfirm(null);
          try {
            await openspecArchiveChange(projectPath, changeName);
            setExpandedName(null);
            await refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        },
      });
    },
    [projectPath, refresh],
  );

  const handleLink = useCallback(
    async (changeName: string, planId: string) => {
      try {
        await openspecLinkChangeToPlan(changeName, planId);
        setLinkingChange(null);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refresh],
  );

  const handleUnlink = useCallback(
    (planId: string, changeName: string) => {
      setConfirm({
        title: "Unlink plan",
        message: `Unlink plan from change "${changeName}"?`,
        confirmLabel: "Unlink",
        destructive: true,
        onConfirm: async () => {
          setConfirm(null);
          try {
            await openspecUnlinkPlanFromChange(planId);
            await refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        },
      });
    },
    [refresh],
  );

  const filteredChanges = useMemo(() => {
    return changes
      .filter((entry) => {
        if (archivedFilter === "active") return !entry.archived;
        if (archivedFilter === "archived") return entry.archived;
        return true;
      })
      .sort((a, b) => {
        if (a.archived !== b.archived) return a.archived ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
  }, [changes, archivedFilter]);

  const archivedCount = useMemo(() => changes.filter((c) => c.archived).length, [changes]);

  const archiveAvailability = useCallback((entry: ChangeCatalogEntry) => {
    const linkedPlan = linkablePlans?.find(
      (plan) => plan.referenceId === entry.linkedPlanReferenceId,
    );
    if (!linkedPlan || linkedPlan.status === "cancelled") {
      return { blocked: false, primary: false, title: "Archive change" };
    }
    if (linkedPlan.status !== "finished") {
      return {
        blocked: true,
        primary: false,
        title: `Cannot archive: linked plan is ${linkedPlan.status}; finish or cancel it first.`,
      };
    }
    if (entry.total === 0 || entry.completed !== entry.total) {
      return {
        blocked: true,
        primary: false,
        title: `Cannot archive: ${entry.completed}/${entry.total} required tasks are complete.`,
      };
    }
    return { blocked: false, primary: true, title: "Archive finished change" };
  }, [linkablePlans]);

  if (!projectPath) {
    return (
      <div className="changes-panel-empty">
        <FolderTree size={20} />
        <p>Open a project to view OpenSpec changes.</p>
      </div>
    );
  }

  return (
    <>
    <div className="changes-panel">
      <div className="changes-panel-header">
        <span className="changes-panel-title">OpenSpec Changes</span>
        <div className="changes-panel-filter-group">
          {(["active", "archived", "all"] as ArchivedFilter[]).map((filter) => {
            const label =
              filter === "active"
                ? `Active (${changes.length - archivedCount})`
                : filter === "archived"
                  ? `Archived (${archivedCount})`
                  : "All";
            return (
              <button
                key={filter}
                type="button"
                className={`changes-panel-filter${archivedFilter === filter ? " is-active" : ""}`}
                title={`Filter: ${filter}`}
                onClick={() => setArchivedFilter(filter)}
              >
                {label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="changes-panel-refresh"
          title="Refresh changes"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? "is-spinning" : ""} />
        </button>
      </div>

      {error && <div className="changes-panel-error">{error}</div>}

      {filteredChanges.length === 0 && !loading && (
        <div className="changes-panel-empty">
          <FolderTree size={20} />
          <p>No {archivedFilter === "archived" ? "archived" : ""} changes found.</p>
        </div>
      )}

      <ul className="changes-panel-list">
        {filteredChanges.map((entry) => (
          <li key={entry.name} className={`changes-panel-item${entry.archived ? " is-archived" : ""}`}>
            <div className="changes-panel-item-row">
              <button
                type="button"
                className="changes-panel-expand"
                title={entry.hasTasks ? "Show tasks" : "No tasks.md"}
                onClick={() => entry.hasTasks && handleExpand(entry.name)}
                disabled={!entry.hasTasks}
              >
                {entry.hasTasks && expandedName === entry.name ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
              </button>
              <span className="changes-panel-item-name" title={entry.name}>
                {entry.name}
              </span>
              <div className="changes-panel-chips">
                {entry.hasProposal && <span className="changes-panel-chip" title="Has proposal.md">P</span>}
                {entry.hasDesign && <span className="changes-panel-chip" title="Has design.md">D</span>}
                {entry.hasTasks && <span className="changes-panel-chip" title="Has tasks.md">T</span>}
                {entry.hasSpecs && <span className="changes-panel-chip" title="Has specs/">S</span>}
              </div>
              {entry.hasTasks && (
                <div
                  className="changes-panel-progress-bar"
                  title={`${entry.completed}/${entry.total} tasks completed`}
                >
                  <div
                    className="changes-panel-progress-fill"
                    style={{ width: `${entry.total > 0 ? (entry.completed / entry.total) * 100 : 0}%` }}
                  />
                  <span className="changes-panel-progress-text">
                    {entry.completed}/{entry.total}
                  </span>
                </div>
              )}
              {entry.linkedPlanReferenceId && onFocusPlan && (
                <button
                  type="button"
                  className="changes-panel-item-link"
                  title={`Focus linked plan ${entry.linkedPlanReferenceId}`}
                  onClick={() => onFocusPlan(entry.linkedPlanReferenceId!)}
                >
                  {entry.linkedPlanReferenceId}
                </button>
              )}
              {linkablePlans && linkablePlans.length > 0 && !entry.archived && (
                <button
                  type="button"
                  className="changes-panel-item-link-action"
                  title="Link to plan"
                  onClick={() => setLinkingChange(linkingChange === entry.name ? null : entry.name)}
                >
                  <Link2 size={12} />
                </button>
              )}
              {entry.linkedPlanReferenceId && !entry.archived && linkablePlans && (
                <button
                  type="button"
                  className="changes-panel-item-unlink-action"
                  title="Unlink plan"
                  onClick={() => {
                    const plan = linkablePlans.find((p) => p.referenceId === entry.linkedPlanReferenceId);
                    if (plan) void handleUnlink(plan.id, entry.name);
                  }}
                >
                  <Unlink size={12} />
                </button>
              )}
              {!entry.archived && (
                <button
                  type="button"
                  className={`changes-panel-item-archive${archiveAvailability(entry).primary ? " is-primary" : ""}`}
                  title={archiveAvailability(entry).title}
                  disabled={archiveAvailability(entry).blocked}
                  onClick={() => void handleArchive(entry.name)}
                >
                  <Archive size={12} />
                  {archiveAvailability(entry).primary ? <span>Archive</span> : null}
                </button>
              )}
            </div>

            {linkingChange === entry.name && linkablePlans && (
              <div className="changes-panel-link-menu">
                {linkablePlans.map((plan) => (
                  <button
                    key={plan.id}
                    type="button"
                    className="changes-panel-link-option"
                    title={`Link ${plan.referenceId} — ${plan.title}`}
                    onClick={() => void handleLink(entry.name, plan.id)}
                  >
                    {plan.referenceId} — {plan.title}
                  </button>
                ))}
              </div>
            )}

            {expandedName === entry.name && (
              <ChangeTasks
                changeName={entry.name}
                tasks={tasksByChange.get(entry.name)}
                loading={tasksLoading}
                error={tasksError}
                onToggle={(line, checked) => void handleToggleTask(entry.name, line, checked)}
              />
            )}
          </li>
      ))}
      </ul>
    </div>
    <ConfirmDialog
      open={confirm !== null}
      title={confirm?.title ?? ""}
      message={confirm?.message ?? ""}
      confirmLabel={confirm?.confirmLabel}
      destructive={confirm?.destructive ?? false}
      onConfirm={() => confirm?.onConfirm()}
      onCancel={() => setConfirm(null)}
    />
    </>
  );
}

type ChangeTasksProps = {
  changeName: string;
  tasks: StructuredTasks | undefined;
  loading: boolean;
  error: string | null;
  onToggle: (line: number, currentChecked: boolean) => void;
};

function ChangeTasks({ tasks, loading, error, onToggle }: ChangeTasksProps) {
  if (loading) {
    return <div className="changes-panel-tasks-loading">Loading tasks…</div>;
  }
  if (error) {
    return <div className="changes-panel-tasks-error">{error}</div>;
  }
  if (!tasks || tasks.phases.length === 0) {
    return <div className="changes-panel-tasks-empty">No tasks.</div>;
  }

  return (
    <div className="changes-panel-tasks">
      {tasks.phases.map((phase: TaskPhase) => {
        const phaseCompleted = phase.tasks.filter((t) => t.checked).length;
        const phaseTotal = phase.tasks.length;
        return (
          <div key={`${phase.line}-${phase.name}`} className="changes-panel-phase">
            <div className="changes-panel-phase-header">
              <span className="changes-panel-phase-name">{phase.name}</span>
              <span className="changes-panel-phase-count">
                {phaseCompleted}/{phaseTotal}
              </span>
            </div>
            <ul className="changes-panel-task-list">
              {phase.tasks.map((task) => (
                <li key={task.line} className="changes-panel-task">
                  <label className="changes-panel-task-label" title={task.text}>
                    <input
                      type="checkbox"
                      className="changes-panel-task-checkbox"
                      checked={task.checked}
                      onChange={() => onToggle(task.line, task.checked)}
                    />
                    <span className="changes-panel-task-text">{task.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
