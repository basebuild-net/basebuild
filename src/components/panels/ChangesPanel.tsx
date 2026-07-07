import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ChevronDown, ChevronRight, FolderTree, RefreshCw } from "lucide-react";

import type { ChangeCatalogEntry, StructuredTasks, TaskPhase } from "../../lib/openspec";
import {
  openspecArchiveChange,
  openspecListChanges,
  openspecReadTasksStructured,
  openspecToggleTask,
} from "../../lib/openspec";

type ChangesPanelProps = {
  projectPath: string | null;
  /** Optional callback to focus the plan linked to a change. */
  onFocusPlan?: (referenceId: string) => void;
};

export function ChangesPanel({ projectPath, onFocusPlan }: ChangesPanelProps) {
  const [changes, setChanges] = useState<ChangeCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [tasksByChange, setTasksByChange] = useState<Map<string, StructuredTasks>>(new Map());
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setError(null);
    try {
      const list = await openspecListChanges(projectPath);
      setChanges(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
        // Reload tasks for this change to reflect the new state.
        await loadTasks(changeName);
        // Also refresh the catalog entry counts.
        void refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [projectPath, loadTasks, refresh],
  );

  const handleArchive = useCallback(
    async (changeName: string) => {
      if (!projectPath) return;
      const ok = window.confirm(
        `Archive change "${changeName}"? This moves it to openspec/changes/archive/.`,
      );
      if (!ok) return;
      try {
        await openspecArchiveChange(projectPath, changeName);
        setExpandedName(null);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [projectPath, refresh],
  );

  const sortedChanges = useMemo(() => {
    // Active first (by name asc), then archived (by name asc).
    return [...changes].sort((a, b) => {
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [changes]);

  if (!projectPath) {
    return (
      <div className="changes-panel-empty">
        <FolderTree size={20} />
        <p>Open a project to view OpenSpec changes.</p>
      </div>
    );
  }

  return (
    <div className="changes-panel">
      <div className="changes-panel-header">
        <span className="changes-panel-title">OpenSpec Changes</span>
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

      {sortedChanges.length === 0 && !loading && (
        <div className="changes-panel-empty">
          <FolderTree size={20} />
          <p>No OpenSpec changes found.</p>
        </div>
      )}

      <ul className="changes-panel-list">
        {sortedChanges.map((entry) => (
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
              <span className="changes-panel-item-progress" title={`${entry.completed}/${entry.total} tasks`}>
                {entry.completed}/{entry.total}
              </span>
              {entry.linkedPlanReferenceId && onFocusPlan && (
                <button
                  type="button"
                  className="changes-panel-item-link"
                  title={`Focus linked plan ${entry.linkedPlanReferenceId}`}
                  onClick={() => onFocusPlan(entry.linkedPlanReferenceId!)}
                >
                  Plan
                </button>
              )}
              {!entry.archived && (
                <button
                  type="button"
                  className="changes-panel-item-archive"
                  title="Archive change"
                  onClick={() => void handleArchive(entry.name)}
                >
                  <Archive size={12} />
                </button>
              )}
            </div>

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
      {tasks.phases.map((phase: TaskPhase) => (
        <div key={`${phase.line}-${phase.name}`} className="changes-panel-phase">
          <div className="changes-panel-phase-name">{phase.name}</div>
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
      ))}
    </div>
  );
}
