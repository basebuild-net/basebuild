import { AlertTriangle } from "lucide-react";
import { ModalPortal } from "../ModalPortal";
import { t } from "../../i18n";

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
    ? t("ideaRoundGate.thisProjectHasNoSchematicYet")
    : t("ideaRoundGate.theSchematicIsIncompleteTheRound");
  return (
    <ModalPortal>
    <div className="modal-overlay" role="dialog" aria-label={t("ideaRoundGate.schematicIncomplete")}>
      <div className="idea-round-gate" title={t("ideaRoundGate.schematicIncompleteWarning")}>
        <div className="idea-round-gate-header">
          <AlertTriangle size={14} />
          <span>{t("ideaRoundGate.schematic", { health: health })}</span>
        </div>
        <p className="idea-round-gate-body">{gap}</p>
        <p className="idea-round-gate-body text-muted">
          {t("ideaRoundGate.groundedRoundsWorkBestWith")}
        </p>
        <div className="idea-round-gate-actions">
          <button className="btn btn-sm btn-primary" type="button" title={t("ideaRoundGate.runTheSchematicWizardFirst")} onClick={onOpenWizard}>
            {t("ideaRoundGate.openWizard")}
          </button>
          <button className="btn btn-sm" type="button" title={t("ideaRoundGate.runTheRoundWithWhatever")} onClick={onProceed}>
            {t("ideaRoundGate.proceedAnyway")}
          </button>
          <button className="btn btn-sm" type="button" title={t("ideaRoundGate.cancelTheRound")} onClick={onCancel}>
            {t("ideaRoundGate.cancel")}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
