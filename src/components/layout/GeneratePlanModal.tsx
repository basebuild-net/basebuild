import { useState } from "react";
import { FileText, Sparkles, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

type GeneratePlanModalProps = {
  open: boolean;
  onClose: () => void;
  onGenerate: (goal: string, contextFile?: string, contextContent?: string) => void;
  onSuggest: (goal: string) => void;
  onCreateBlank: () => void;
  showSuggestMore?: boolean;
};

export function GeneratePlanModal({ open, onClose, onGenerate, onSuggest, onCreateBlank, showSuggestMore }: GeneratePlanModalProps) {
  const [goal, setGoal] = useState("");
  const [contextFile, setContextFile] = useState<string | null>(null);
  const [contextContent, setContextContent] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  if (!open) return null;

  async function selectFile() {
    try {
      const path = await invoke<string | null>("pick_project_directory");
      if (!path) return;
      const content = await invoke<string>("read_file", { path });
      setContextFile(path);
      setContextContent(content);
      if (content.length > 50000) {
        setWarning("File is large (>50KB) and may exceed context limits.");
      } else {
        setWarning(null);
      }
    } catch (e) {
      setWarning(`Failed to read file: ${e}`);
    }
  }

  function run(fn: (g: string, cf?: string, cc?: string) => void) {
    const g = goal.trim();
    if (!g && !contextContent) {
      setWarning("Enter a goal or select a context file before generating.");
      return;
    }
    setGoal("");
    fn(g, contextFile ?? undefined, contextContent ?? undefined);
    setContextFile(null);
    setContextContent(null);
    setWarning(null);
    onClose();
  }

  const fileName = contextFile ? contextFile.split(/[\\/]/).pop() ?? contextFile : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal plan-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Generate plans</h3>
          <button className="btn-icon" type="button" title="Close" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body stack" style={{ gap: "10px" }}>
          <label className="stack-sm">
            <span className="text-sm text-muted">Goal or project description</span>
            <textarea
              className="input pre"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={5}
              autoFocus
              placeholder="What should this project become? Basebuild will suggest scoped MVP plans."
            />
          </label>
          <div className="stack-sm">
            <span className="text-sm text-muted">Context</span>
            <div className="row gap-sm">
              <button className="btn btn-sm" type="button" onClick={() => void selectFile()} title="Select a file as context">
                <FileText size={12} /> Select context file
              </button>
              {fileName ? (
                <span className="text-sm mono" title={contextFile ?? ""}>
                  {fileName}
                  <button className="btn-icon btn-icon-sm" type="button" title="Remove context" onClick={() => { setContextFile(null); setContextContent(null); setWarning(null); }}>
                    <X size={10} />
                  </button>
                </span>
              ) : (
                <span className="text-sm text-muted">No file selected</span>
              )}
            </div>
          </div>
          {warning ? <p className="text-sm text-danger">{warning}</p> : null}
          <div className="stack-sm">
            <span className="text-sm text-muted">Options</span>
            <div className="row">
              <button
                className="btn btn-primary"
                type="button"
                title="Generate brand new plans from this goal"
                onClick={() => run(onGenerate)}
              >
                <Sparkles size={12} /> Generate plans
              </button>
              {showSuggestMore ? (
                <button
                  className="btn"
                  type="button"
                  title="Suggest additional plans based on the current goal and existing plans"
                  onClick={() => run(onSuggest)}
                >
                  Suggest more
                </button>
              ) : null}
              <button
                className="btn btn-ghost"
                type="button"
                title="Create a blank plan without AI"
                onClick={() => {
                  onCreateBlank();
                  onClose();
                }}
              >
                Create blank
              </button>
            </div>
          </div>
          <p className="text-muted text-sm">
            AI generation runs through OMP. Until the backend skill is wired,
            this creates placeholder plans that carry the goal text.
          </p>
        </div>
      </div>
    </div>
  );
}
