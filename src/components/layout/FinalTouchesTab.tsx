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

type FinalTouchesTabProps = {
  projectPath: string | null;
};

const STEP_KINDS: { value: FinalTouchStepKind; label: string; configLabel: string }[] = [
  { value: "shell", label: "Shell", configLabel: "Command" },
  { value: "validate", label: "Validate", configLabel: "Prompt" },
  { value: "commit", label: "Commit", configLabel: "Message" },
  { value: "pull_request", label: "Pull Request", configLabel: "Title" },
];
const STEP_KIND_OPTION_ITEMS: OptionListOption<FinalTouchStepKind>[] = [
  { id: "shell", label: "Shell", title: "Run a shell command" },
  { id: "validate", label: "Validate", title: "Validate with a prompt" },
  { id: "commit", label: "Commit", title: "Create a commit" },
  { id: "pull_request", label: "Pull Request", title: "Open a pull request" },
];

export function FinalTouchesTab({ projectPath }: FinalTouchesTabProps) {
  const [steps, setSteps] = useState<FinalTouchStep[]>([]);
  const [newKind, setNewKind] = useState<FinalTouchStepKind>("shell");
  const [newLabel, setNewLabel] = useState("");
  const [newConfig, setNewConfig] = useState("");

  useEffect(() => {
    if (!projectPath) {
      setSteps([]);
      return;
    }
    void loadSteps(projectPath);
  }, [projectPath]);

  async function loadSteps(path: string) {
    try {
      setSteps(await listFinalTouchSteps(path));
    } catch {
      setSteps([]);
    }
  }

  async function handleAdd() {
    if (!projectPath || !newLabel.trim()) return;
    const configKey = STEP_KINDS.find((k) => k.value === newKind)?.configLabel.toLowerCase() ?? "command";
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
    return <p className="text-muted text-sm">Open a project to configure final touches.</p>;
  }

  return (
    <div className="stack">
      <h3>Final Touches</h3>
      <p className="text-muted text-sm">
        Post-completion actions executed when a plan run finishes. Shell and validate run locally;
        commit and pull_request write to the remote and are disabled by default.
      </p>

      {/* Existing steps */}
      {steps.length > 0 ? (
        <div className="final-touch-list">
          {steps.map((step) => (
            <div key={step.id} className="final-touch-step">
              <div className="final-touch-step-info">
                <span className="final-touch-step-label" title={step.label}>
                  {step.label}
                </span>
                <span className="final-touch-step-kind" title={`Kind: ${step.kind}`}>
                  {step.kind}
                </span>
                <span className="final-touch-step-config" title="Configuration">
                  {Object.entries(step.config).map(([k, v]) => `${k}: ${String(v)}`).join(", ")}
                </span>
              </div>
              <div className="final-touch-step-actions">
                <label className="final-touch-toggle" title={`Enable/disable: ${step.label}`}>
                  <input
                    type="checkbox"
                    checked={step.enabled}
                    onChange={(e) => handleToggle(step.id, e.target.checked)}
                  />
                  <span>{step.enabled ? "Enabled" : "Disabled"}</span>
                </label>
                <button
                  className="btn-icon"
                  type="button"
                  onClick={() => handleDelete(step.id)}
                  title={`Delete step: ${step.label}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted text-sm">No steps configured. Add one below.</p>
      )}

      {/* Add new step */}
      <div className="final-touch-add">
        <OptionList
          value={newKind}
          options={STEP_KIND_OPTION_ITEMS}
          onChange={(id) => setNewKind(id)}
          label="Step kind"
        />
        <input
          type="text"
          placeholder="Label (e.g. Run tests)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          title="Step label"
        />
        <input
          type="text"
          placeholder={
            STEP_KINDS.find((k) => k.value === newKind)?.configLabel ?? "Command"
          }
          value={newConfig}
          onChange={(e) => setNewConfig(e.target.value)}
          title={STEP_KINDS.find((k) => k.value === newKind)?.configLabel ?? "Command"}
        />
        <button
          className="btn btn-sm btn-primary"
          type="button"
          onClick={handleAdd}
          disabled={!newLabel.trim()}
          title="Add final-touch step"
        >
          <Plus size={12} /> Add
        </button>
      </div>
    </div>
  );
}
