import { useEffect, useState } from "react";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { X } from "lucide-react";
import type { NewPlan, Plan, PlanStatus } from "../../lib/plans";
import { PLAN_STATUS_LABEL } from "../../lib/plans";
import { OptionList, type OptionListOption } from "./OptionList";
import { ModalPortal } from "../ModalPortal";
const STATUS_OPTION_ITEMS: OptionListOption<PlanStatus>[] = [
  { id: "draft", label: PLAN_STATUS_LABEL.draft, title: "Plan is still being drafted" },
  { id: "openspec", label: PLAN_STATUS_LABEL.openspec, title: "Plan is being refined in OpenSpec" },
  { id: "ready", label: PLAN_STATUS_LABEL.ready, title: "Plan is ready to run" },
  { id: "running", label: PLAN_STATUS_LABEL.running, title: "Plan is currently running" },
  { id: "finished", label: PLAN_STATUS_LABEL.finished, title: "Plan has finished successfully" },
  { id: "cancelled", label: PLAN_STATUS_LABEL.cancelled, title: "Plan was cancelled" },
];

type EditPlanModalProps = {
  plan: Plan | null;
  open: boolean;
  onClose: () => void;
  onSave: (plan: NewPlan) => void;
};

export function EditPlanModal({ plan, open, onClose, onSave }: EditPlanModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState("");
  const [status, setStatus] = useState<PlanStatus>("draft");
  const [priority, setPriority] = useState(50);
  useEscapeKey(open, onClose);
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (!plan) {
      setTitle("");
      setDescription("");
      setGoal("");
      setStatus("draft");
      setPriority(50);
      setTags("");
      return;
    }
    setTitle(plan.title);
    setDescription(plan.description);
    setGoal(plan.goal ?? "");
    setStatus(plan.status);
    setPriority(plan.priority);
    setTags(plan.tags.join(","));
  }, [plan, open]);

  if (!open || !plan) return null;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      title: title.trim(),
      description: description.trim(),
      goal: goal.trim() || null,
      status,
      priority: Math.max(0, Math.min(100, priority)),
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    onClose();
  }

  return (
    <ModalPortal>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal plan-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit {plan.referenceId}</h3>
          <button className="btn-icon" type="button" title="Close" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <form className="modal-body stack" onSubmit={handleSave}>
          <label className="stack-sm">
            <span className="text-sm text-muted">Title</span>
            <input
              className="input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label className="stack-sm">
            <span className="text-sm text-muted">Description</span>
            <textarea
              className="input pre"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              required
            />
          </label>
          <label className="stack-sm">
            <span className="text-sm text-muted">Goal / Target</span>
            <input
              className="input"
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What larger objective does this serve?"
            />
          </label>
          <div className="row">
            <label className="stack-sm flex-1">
              <span className="text-sm text-muted">Status</span>
              <OptionList
                value={status}
                options={STATUS_OPTION_ITEMS}
                onChange={(id) => setStatus(id)}
                label="Plan status"
              />
            </label>
            <label className="stack-sm flex-1">
              <span className="text-sm text-muted">Priority (0–100)</span>
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="stack-sm">
            <span className="text-sm text-muted">Tags (comma-separated)</span>
            <input
              className="input"
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button className="btn" type="button" title="Cancel" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" title="Save plan">
              Save plan
            </button>
          </div>
        </form>
      </div>
    </div>
    </ModalPortal>
  );
}
