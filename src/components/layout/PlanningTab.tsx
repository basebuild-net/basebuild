import { useCallback, useEffect, useState } from "react";
import { Lightbulb, RefreshCw, Save } from "lucide-react";
import {
  listPlanningPrompts,
  setPlanningPrompt,
  resetPlanningPrompt,
  type PlanningPromptEntry,
  PLANNING_PROMPT_KEYS,
} from "../../lib/planningPrompts";
import { SkeletonRows } from "./Loading";
import { t } from "../../i18n";

const PROMPT_META = (): Record<string, { label: string; description: string }> => ({
  [PLANNING_PROMPT_KEYS.chatSystem]: {
    label: t("planningTab.chatSystemPrompt"),
    description: t("planningTab.systemPromptForGeneralChatTurns"),
  },
  [PLANNING_PROMPT_KEYS.ideaGeneration]: {
    label: t("planningTab.ideaGenerationPrompt"),
    description: t("planningTab.systemPromptUsedWhenGeneratingIdeas"),
  },
  [PLANNING_PROMPT_KEYS.planGeneration]: {
    label: t("planningTab.planGenerationPrompt"),
    description: t("planningTab.systemPromptUsedWhenGeneratingPlans"),
  },
  [PLANNING_PROMPT_KEYS.categoryGeneration]: {
    label: t("planningTab.categoryGenerationPrompt"),
    description: t("planningTab.systemPromptUsedWhenSuggestingIdea"),
  },
});

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
        <h3>{t("planningTab.planningPrompts")}</h3>
        <button
          className="btn-icon"
          title={t("planningTab.reloadPrompts")}
          type="button"
          onClick={() => void load()}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <p className="text-muted text-sm">
        {t("planningTab.customizeTheSystemPromptsUsed")}
      </p>
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      {loading && prompts.length === 0 ? (
        <SkeletonRows rows={4} label={t("planningTab.loadingPlanningPrompts")} />
      ) : (
        <div className="stack">
          {prompts.map((p) => {
            const meta = PROMPT_META()[p.key] ?? { label: p.key, description: "" };
            const draft = drafts[p.key] ?? p.value;
            const isModified = draft !== p.default;
            return (
              <div key={p.key} className="settings-prompt-card">
                <div className="settings-prompt-card-header">
                  <Lightbulb size={12} />
                  <span className="settings-prompt-card-title">{meta.label}</span>
                  {isModified ? <span className="settings-prompt-modified">{t("planningTab.modified")}</span> : null}
                </div>
                {meta.description ? <p className="text-muted text-sm">{meta.description}</p> : null}
                <textarea
                  className="input settings-prompt-textarea"
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.key]: e.target.value }))}
                  rows={6}
                  title={t("planningTab.edit", { label: meta.label })}
                />
                <div className="settings-prompt-actions">
                  <button
                    className="btn btn-sm btn-primary"
                    type="button"
                    title={t("planningTab.saveThisPrompt")}
                    disabled={savingKey === p.key}
                    onClick={() => void handleSave(p.key)}
                  >
                    <Save size={11} /> {savedKey === p.key ? t("planningTab.saved") : t("planningTab.save")}
                  </button>
                  <button
                    className="btn btn-sm"
                    type="button"
                    title={t("planningTab.resetToDefault")}
                    disabled={savingKey === p.key || !isModified}
                    onClick={() => void handleReset(p.key)}
                  >
                    <RefreshCw size={11} /> {t("planningTab.resetToDefault")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
