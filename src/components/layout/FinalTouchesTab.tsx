import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  createFinalTouchStep,
  deleteFinalTouchStep,
  listFinalTouchSteps,
  setFinalTouchStepEnabled,
  type FinalTouchStep,
  type FinalTouchStepKind,
} from "../../lib/finalTouches";
import { OptionList, type OptionListOption } from "./OptionList";
import { SkeletonRows } from "./Loading";
import { t } from "../../i18n";

type FinalTouchesTabProps = {
  projectPath: string | null;
};

const STEP_KINDS = (): { value: FinalTouchStepKind; label: string; configLabel: string }[] => [
  { value: "shell", label: t("finalTouchesTab.shell"), configLabel: t("finalTouchesTab.command2") },
  { value: "validate", label: t("finalTouchesTab.validate"), configLabel: t("finalTouchesTab.prompt") },
  { value: "commit", label: t("finalTouchesTab.commit"), configLabel: t("finalTouchesTab.message") },
  { value: "pull_request", label: t("finalTouchesTab.pullRequest"), configLabel: t("finalTouchesTab.title") },
];
const STEP_KIND_OPTION_ITEMS = (): OptionListOption<FinalTouchStepKind>[] => [
  { id: "shell", label: t("finalTouchesTab.shell"), title: t("finalTouchesTab.runAShellCommand") },
  { id: "validate", label: t("finalTouchesTab.validate"), title: t("finalTouchesTab.validateWithAPrompt") },
  { id: "commit", label: t("finalTouchesTab.commit"), title: t("finalTouchesTab.createACommit") },
  { id: "pull_request", label: t("finalTouchesTab.pullRequest"), title: t("finalTouchesTab.openAPullRequest") },
];

export function FinalTouchesTab({ projectPath }: FinalTouchesTabProps) {
  const [steps, setSteps] = useState<FinalTouchStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKind, setNewKind] = useState<FinalTouchStepKind>("shell");
  const [newLabel, setNewLabel] = useState("");
  const [newConfig, setNewConfig] = useState("");

  useEffect(() => {
    if (!projectPath) {
      setSteps([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void loadSteps(projectPath);
  }, [projectPath]);

  // Only the project-scoped load flips `loading`; the reloads after add /
  // toggle / delete keep the existing rows on screen instead of blanking.
  async function loadSteps(path: string) {
    try {
      setSteps(await listFinalTouchSteps(path));
    } catch {
      setSteps([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    if (!projectPath || !newLabel.trim()) return;
    const configKey = STEP_KINDS().find((k) => k.value === newKind)?.configLabel.toLowerCase() ?? "command";
    try {
      await createFinalTouchStep({
        projectPath,
        kind: newKind,
        label: newLabel.trim(),
        config: { [configKey]: newConfig.trim() },
      });
      setNewLabel("");
      setNewConfig("");
      await loadSteps(projectPath);
    } catch {
      // Non-blocking.
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    try {
      await setFinalTouchStepEnabled(id, enabled);
      if (projectPath) await loadSteps(projectPath);
    } catch {
      // Non-blocking.
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteFinalTouchStep(id);
      if (projectPath) await loadSteps(projectPath);
    } catch {
      // Non-blocking.
    }
  }

  if (!projectPath) {
    return <p className="text-muted text-sm">{t("finalTouchesTab.openAProjectToConfigure")}</p>;
  }

  return (
    <div className="stack">
      <h3>{t("finalTouchesTab.finalTouches")}</h3>
      <p className="text-muted text-sm">
        {t("finalTouchesTab.postCompletionActionsExecutedWhen")}
      </p>

      {/* Existing steps */}
      {loading ? (
        <SkeletonRows rows={3} label={t("finalTouchesTab.loadingFinalTouchSteps")} />
      ) : steps.length > 0 ? (
        <div className="final-touch-list">
          {steps.map((step) => (
            <div key={step.id} className="final-touch-step">
              <div className="final-touch-step-info">
                <span className="final-touch-step-label" title={step.label}>
                  {step.label}
                </span>
                <span className="final-touch-step-kind" title={t("finalTouchesTab.kind", { kind: step.kind })}>
                  {step.kind}
                </span>
                <span className="final-touch-step-config" title={t("finalTouchesTab.configuration")}>
                  {Object.entries(step.config).map(([k, v]) => `${k}: ${String(v)}`).join(", ")}
                </span>
              </div>
              <div className="final-touch-step-actions">
                <label className="final-touch-toggle" title={t("finalTouchesTab.enableDisable", { label: step.label })}>
                  <input
                    type="checkbox"
                    checked={step.enabled}
                    onChange={(e) => handleToggle(step.id, e.target.checked)}
                  />
                  <span>{step.enabled ? t("finalTouchesTab.enabled") : t("finalTouchesTab.disabled")}</span>
                </label>
                <button
                  className="btn-icon"
                  type="button"
                  onClick={() => handleDelete(step.id)}
                  title={t("finalTouchesTab.deleteStep", { label: step.label })}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted text-sm">{t("finalTouchesTab.noStepsConfiguredAddOne")}</p>
      )}

      {/* Add new step */}
      <div className="final-touch-add">
        <OptionList
          value={newKind}
          options={STEP_KIND_OPTION_ITEMS()}
          onChange={(id) => setNewKind(id)}
          label={t("finalTouchesTab.stepKind")}
        />
        <input
          type="text"
          placeholder={t("finalTouchesTab.labelEGRunTests")}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          title={t("finalTouchesTab.stepLabel")}
        />
        <input
          type="text"
          placeholder={
            STEP_KINDS().find((k) => k.value === newKind)?.configLabel ?? t("finalTouchesTab.command")
          }
          value={newConfig}
          onChange={(e) => setNewConfig(e.target.value)}
          title={STEP_KINDS().find((k) => k.value === newKind)?.configLabel ?? t("finalTouchesTab.command")}
        />
        <button
          className="btn btn-sm btn-primary"
          type="button"
          onClick={handleAdd}
          disabled={!newLabel.trim()}
          title={t("finalTouchesTab.addFinalTouchStep")}
        >
          <Plus size={12} /> {t("finalTouchesTab.add")}
        </button>
      </div>
    </div>
  );
}
