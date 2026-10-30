import { useEffect, useState } from "react";
import { FileText, Save, X } from "lucide-react";
import { DEFAULT_SCHEMATIC } from "../../lib/schematic";
import { ModalPortal } from "../ModalPortal";
import { t } from "../../i18n";

type ProjectDescriptionModalProps = {
  open: boolean;
  onClose: () => void;
  existingContent: string | null;
  onSave: (content: string) => void;
  onOpenFile: () => void;
};

export function ProjectDescriptionModal({ open, onClose, existingContent, onSave, onOpenFile }: ProjectDescriptionModalProps) {
  const [content, setContent] = useState(DEFAULT_SCHEMATIC);

  useEffect(() => {
    setContent(existingContent ?? DEFAULT_SCHEMATIC);
  }, [existingContent, open]);

  if (!open) return null;

  return (
    <ModalPortal>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal plan-modal project-desc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t("projectDescriptionModal.projectSchematic")}</h3>
          <button className="btn-icon" type="button" title={t("projectDescriptionModal.close")} aria-label={t("projectDescriptionModal.close")} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body stack focus-plan-body">
          <p className="text-sm text-muted">
            {t("projectDescriptionModal.basebuildUsesThisFileAs")}
          </p>
          <textarea
            className="input pre"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            autoFocus
          />
          <div className="modal-actions">
            <button className="btn" type="button" title={t("projectDescriptionModal.cancel")} onClick={onClose}>
              {t("projectDescriptionModal.cancel")}
            </button>
            <button className="btn" type="button" title={t("projectDescriptionModal.openProjectSchematicFile")} onClick={onOpenFile}>
              <FileText size={12} /> {t("projectDescriptionModal.openFile")}
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => {
                onSave(content);
                onClose();
              }}
            >
              <Save size={12} /> {t("projectDescriptionModal.saveSchematic")}
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
