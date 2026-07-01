import { useState } from "react";
import { Sparkles, X } from "lucide-react";

type GeneratePlanModalProps = {
  open: boolean;
  onClose: () => void;
  onGenerate: (goal: string) => void;
  onSuggest: (goal: string) => void;
  onCreateBlank: () => void;
};

export function GeneratePlanModal({ open, onClose, onGenerate, onSuggest, onCreateBlank }: GeneratePlanModalProps) {
  const [goal, setGoal] = useState("");

  if (!open) return null;

  function run(fn: (g: string) => void) {
    const g = goal.trim();
    setGoal("");
    fn(g);
    onClose();
  }

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
              <button
                className="btn"
                type="button"
                title="Suggest additional plans based on the current goal and existing plans"
                onClick={() => run(onSuggest)}
              >
                Suggest more
              </button>
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
