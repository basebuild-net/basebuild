import { useEffect, useState } from "react";
import { CheckCircle, Clock, Copy, TerminalSquare, X } from "lucide-react";
import type { Plan, PlanFocusContext, PlanStatus } from "../../lib/plans";
import { PLAN_STATUS_LABEL } from "../../lib/plans";

type FocusPlanModalProps = {
  plan: Plan | null;
  open: boolean;
  onClose: () => void;
  onSetStatus: (id: string, status: PlanStatus) => void;
  onCopyReference: (refId: string) => void;
  onOpenInTerminal: (plan: Plan) => void;
  onSetContext: (id: string, context: PlanFocusContext) => void;
};

export function FocusPlanModal({
  plan,
  open,
  onClose,
  onSetStatus,
  onCopyReference,
  onOpenInTerminal,
  onSetContext,
}: FocusPlanModalProps) {
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState("");
  const [terminalTail, setTerminalTail] = useState("");

  useEffect(() => {
    if (!plan) {
      setNotes("");
      setFiles("");
      setTerminalTail("");
      return;
    }
    setNotes(plan.context?.notes ?? "");
    setFiles(plan.context?.files?.join("\n") ?? "");
    setTerminalTail(plan.context?.terminalOutputTail ?? "");
  }, [plan, open]);

  if (!open || !plan) return null;
  const currentPlan = plan;

  const statusActions: { status: PlanStatus; label: string; icon: typeof Clock }[] = [
    { status: "openspec", label: "Start OpenSpec", icon: Clock },
    { status: "waiting", label: "Mark waiting", icon: Clock },
    { status: "in_progress", label: "Start in progress", icon: TerminalSquare },
    { status: "finished", label: "Mark finished", icon: CheckCircle },
  ];

  function handleSaveContext() {
    onSetContext(currentPlan.id, {
      notes,
      files: files
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean),
      terminalOutputTail: terminalTail.trim() || undefined,
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal plan-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {plan.referenceId} <span className="text-muted">-</span> {plan.title}
          </h3>
          <button className="btn-icon" type="button" title="Close" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body stack" style={{ gap: "10px" }}>
          <div className="card stack-sm" style={{ background: "var(--bb-surface)" }}>
            <span className="text-sm text-muted">Status</span>
            <span className="pill">{PLAN_STATUS_LABEL[plan.status]}</span>
          </div>

          <div className="card stack-sm">
            <span className="text-sm text-muted">Description</span>
            <p>{plan.description}</p>
            {plan.goal ? <p className="text-sm text-muted">Goal: {plan.goal}</p> : null}
          </div>

          <label className="stack-sm">
            <span className="text-sm text-muted">Focus notes</span>
            <textarea
              className="input pre"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Context, decisions, blockers…"
            />
          </label>
          <label className="stack-sm">
            <span className="text-sm text-muted">Relevant files (one per line)</span>
            <textarea
              className="input pre"
              value={files}
              onChange={(e) => setFiles(e.target.value)}
              rows={2}
            />
          </label>
          <label className="stack-sm">
            <span className="text-sm text-muted">Terminal output tail</span>
            <textarea
              className="input pre"
              value={terminalTail}
              onChange={(e) => setTerminalTail(e.target.value)}
              rows={2}
            />
          </label>

          <div className="row">
            {statusActions
              .filter((a) => a.status !== plan.status)
              .map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.status}
                    className="btn btn-sm"
                    type="button"
                    onClick={() => {
                      handleSaveContext();
                      onSetStatus(currentPlan.id, a.status);
                      if (a.status === "in_progress") {
                        onOpenInTerminal(currentPlan);
                      }
                      onClose();
                    }}
                  >
                    <Icon size={12} /> {a.label}
                  </button>
                );
              })}
          </div>
        </div>
        <div className="modal-actions">
          <button
            className="btn"
            type="button"
            onClick={() => {
              handleSaveContext();
              onClose();
            }}
          >
            Save context
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              handleSaveContext();
              onCopyReference(currentPlan.referenceId);
            }}
          >
            <Copy size={12} /> Copy ref
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              handleSaveContext();
              onOpenInTerminal(currentPlan);
            }}
          >
            <TerminalSquare size={12} /> Open in terminal
          </button>
        </div>
      </div>
    </div>
  );
}
