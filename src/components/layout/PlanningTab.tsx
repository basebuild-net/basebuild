import { useCallback, useEffect, useState } from "react";
import { Lightbulb, RefreshCw, Save } from "lucide-react";
import {
  listPlanningPrompts,
  setPlanningPrompt,
  resetPlanningPrompt,
  type PlanningPromptEntry,
  PLANNING_PROMPT_KEYS,
} from "../../lib/planningPrompts";

const PROMPT_META: Record<string, { label: string; description: string }> = {
  [PLANNING_PROMPT_KEYS.chatSystem]: {
    label: "Chat system prompt",
    description: "System prompt for general chat turns.",
  },
  [PLANNING_PROMPT_KEYS.ideaGeneration]: {
    label: "Idea generation prompt",
    description: "System prompt used when generating ideas from a conversation.",
  },
  [PLANNING_PROMPT_KEYS.planGeneration]: {
    label: "Plan generation prompt",
    description: "System prompt used when generating plans from accepted ideas.",
  },
  [PLANNING_PROMPT_KEYS.categoryGeneration]: {
    label: "Category generation prompt",
    description: "System prompt used when suggesting idea categories.",
  },
};

type PlanningTabProps = {
  projectPath: string | null;
};

export function PlanningTab({ projectPath: _projectPath }: PlanningTabProps) {
  const [prompts, setPrompts] = useState<PlanningPromptEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listPlanningPrompts();
      setPrompts(list);
      const draftMap: Record<string, string> = {};
      for (const p of list) draftMap[p.key] = p.value;
      setDrafts(draftMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(
    async (key: string) => {
      const value = drafts[key];
      if (value === undefined) return;
      setSavingKey(key);
      setError(null);
      try {
        await setPlanningPrompt(key, value);
        setSavedKey(key);
        setTimeout(() => setSavedKey(null), 1500);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingKey(null);
      }
    },
    [drafts, load],
  );

  const handleReset = useCallback(
    async (key: string) => {
      setSavingKey(key);
      setError(null);
      try {
        await resetPlanningPrompt(key);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingKey(null);
      }
    },
    [load],
  );

  return (
    <div className="stack">
      <div className="settings-section-header">
        <h3>Planning Prompts</h3>
        <button
          className="btn-icon"
          title="Reload prompts"
          type="button"
          onClick={() => void load()}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <p className="text-muted text-sm">
        Customize the system prompts used for chat, idea generation, plan
        generation, and category suggestions. Reset to restore defaults.
      </p>
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      {loading ? <p className="text-muted text-sm">Loading…</p> : null}
      <div className="stack">
        {prompts.map((p) => {
          const meta = PROMPT_META[p.key] ?? { label: p.key, description: "" };
          const draft = drafts[p.key] ?? p.value;
          const isModified = draft !== p.default;
          return (
            <div key={p.key} className="settings-prompt-card">
              <div className="settings-prompt-card-header">
                <Lightbulb size={12} />
                <span className="settings-prompt-card-title">{meta.label}</span>
                {isModified ? <span className="settings-prompt-modified">modified</span> : null}
              </div>
              {meta.description ? <p className="text-muted text-sm">{meta.description}</p> : null}
              <textarea
                className="input settings-prompt-textarea"
                value={draft}
                onChange={(e) => setDrafts((d) => ({ ...d, [p.key]: e.target.value }))}
                rows={6}
                title={`Edit ${meta.label}`}
              />
              <div className="settings-prompt-actions">
                <button
                  className="btn btn-sm btn-primary"
                  type="button"
                  title="Save this prompt"
                  disabled={savingKey === p.key}
                  onClick={() => void handleSave(p.key)}
                >
                  <Save size={11} /> {savedKey === p.key ? "Saved" : "Save"}
                </button>
                <button
                  className="btn btn-sm"
                  type="button"
                  title="Reset to default"
                  disabled={savingKey === p.key || !isModified}
                  onClick={() => void handleReset(p.key)}
                >
                  <RefreshCw size={11} /> Reset to default
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
