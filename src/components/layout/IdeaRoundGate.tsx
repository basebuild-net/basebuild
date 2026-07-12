import { AlertTriangle } from "lucide-react";

type IdeaRoundGateProps = {
  open: boolean;
  /** Schematic health driving the warning copy. */
  health: "partial" | "missing";
  onOpenWizard: () => void;
  onProceed: () => void;
  onCancel: () => void;
};

/**
 * Soft gate shown when a generation round starts without a complete
 * schematic: names the gap, offers the wizard first, and keeps an explicit
 * proceed-anyway path (grounded-generation soft-gate contract).
 */
export function IdeaRoundGate({ open, health, onOpenWizard, onProceed, onCancel }: IdeaRoundGateProps) {
  if (!open) return null;
  const gap = health === "missing"
    ? "This project has no schematic yet — the round will run without focus grounding."
    : "The schematic is incomplete — the round will run with partial grounding.";
  return (
    <div className="modal-overlay" role="dialog" aria-label="Schematic incomplete">
      <div className="idea-round-gate" title="Schematic incomplete warning">
        <div className="idea-round-gate-header">
          <AlertTriangle size={14} />
          <span>Schematic {health}</span>
        </div>
        <p className="idea-round-gate-body">{gap}</p>
        <p className="idea-round-gate-body text-muted">
          Grounded rounds work best with a complete schematic (vision, goals,
          priorities). You can run the wizard first, or proceed anyway.
        </p>
        <div className="idea-round-gate-actions">
          <button className="btn btn-sm btn-primary" type="button" title="Run the schematic wizard first" onClick={onOpenWizard}>
            Open wizard
          </button>
          <button className="btn btn-sm" type="button" title="Run the round with whatever grounding exists" onClick={onProceed}>
            Proceed anyway
          </button>
          <button className="btn btn-sm" type="button" title="Cancel the round" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
