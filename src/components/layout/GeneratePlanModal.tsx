import { useState } from "react";
import { FileText, FolderOpen, Sparkles, Type, Wand2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

type GeneratePlanModalProps = {
  open: boolean;
  onClose: () => void;
  onGenerate: (goal: string, contextFile?: string, contextContent?: string) => void;
  onSuggest: (goal: string) => void;
  onCreateBlank: () => void;
  showSuggestMore?: boolean;
};

type Mode = "ai-expand" | "existing-schema" | "from-context";

export function GeneratePlanModal({ open, onClose, onGenerate, onSuggest, onCreateBlank, showSuggestMore }: GeneratePlanModalProps) {
  const [mode, setMode] = useState<Mode>("ai-expand");
  const [goal, setGoal] = useState("");
  const [contextFile, setContextFile] = useState<string | null>(null);
  const [contextContent, setContextContent] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  if (!open) return null;

  async function selectFile() {
    try {
      const path = await invoke<string | null>("pick_context_file");
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

  async function selectFolder() {
    try {
      const path = await invoke<string | null>("pick_context_folder");
      if (!path) return;
      // For folders, store the path as context - the backend can enumerate it
      setContextFile(path);
      setContextContent(null);
      setWarning(null);
    } catch (e) {
      setWarning(`Failed to read folder: ${e}`);
    }
  }

  function run(fn: (g: string, cf?: string, cc?: string) => void) {
    const g = goal.trim();
    if (!g && !contextContent && mode !== "from-context") {
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

  const modes: { id: Mode; icon: typeof Type; title: string; desc: string }[] = [
    { id: "ai-expand", icon: Wand2, title: "Describe & expand", desc: "Write a simple description, then use AI to build a full schema" },
    { id: "existing-schema", icon: FileText, title: "Existing schema", desc: "I already have a basebuild schema file or folder" },
    { id: "from-context", icon: Sparkles, title: "From project context", desc: "Generate based on the current project context" },
  ];

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
            <span className="text-sm text-muted">What is the goal, scope, and pitch of this project?</span>
            <textarea
              className="input pre"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={4}
              autoFocus
              placeholder="e.g. Build a desktop app that manages OMP terminals with plan generation, chat UI, and terminal debug mode"
            />
          </label>

          <div className="stack-sm">
            <span className="text-sm text-muted">Choose how to start</span>
            <div className="plan-mode-list">
              {modes.map((m) => {
                const Icon = m.icon;
                const isActive = mode === m.id;
                return (
                  <button
                    key={m.id}
                    className={`plan-mode-card${isActive ? " is-active" : ""}`}
                    type="button"
                    onClick={() => setMode(m.id)}
                  >
                    <Icon size={14} />
                    <div className="plan-mode-info">
                      <span className="plan-mode-title">{m.title}</span>
                      <span className="plan-mode-desc">{m.desc}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {mode === "existing-schema" ? (
            <div className="stack-sm">
              <span className="text-sm text-muted">Context file or folder</span>
              <div className="row gap-sm">
                <button className="btn btn-sm" type="button" onClick={() => void selectFile()} title="Select a file">
                  <FileText size={12} /> Select file
                </button>
                <button className="btn btn-sm" type="button" onClick={() => void selectFolder()} title="Select a folder">
                  <FolderOpen size={12} /> Select folder
                </button>
                {fileName ? (
                  <span className="text-sm mono" title={contextFile ?? ""}>
                    {fileName}
                    <button className="btn-icon btn-icon-sm" type="button" title="Remove context" onClick={() => { setContextFile(null); setContextContent(null); setWarning(null); }}>
                      <X size={10} />
                    </button>
                  </span>
                ) : (
                  <span className="text-sm text-muted">No file or folder selected</span>
                )}
              </div>
            </div>
          ) : null}

          {mode === "ai-expand" ? (
            <div className="stack-sm">
              <span className="text-sm text-muted">Context (optional)</span>
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
          ) : null}

          {warning ? <p className="text-sm text-danger">{warning}</p> : null}

          <div className="stack-sm">
            <div className="row">
              <button
                className="btn btn-primary"
                type="button"
                title={mode === "from-context" ? "Generate from project context" : "Generate plans from this goal"}
                onClick={() => run(onGenerate)}
              >
                <Sparkles size={12} />
                {mode === "from-context" ? "Generate from context" : mode === "existing-schema" ? "Generate from schema" : "Generate plans"}
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
