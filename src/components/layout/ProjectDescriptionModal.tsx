import { useEffect, useState } from "react";
import { FileText, Save, X } from "lucide-react";
import { DEFAULT_SCHEMATIC } from "../../lib/schematic";

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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal plan-modal project-desc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Project Schematic</h3>
          <button className="btn-icon" type="button" title="Close" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body stack focus-plan-body">
          <p className="text-sm text-muted">
            Basebuild uses this file as the source of truth for AI plan generation.
            Save it to `.basebuild/project-schematic.md`.
          </p>
          <textarea
            className="input pre"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            autoFocus
          />
          <div className="modal-actions">
            <button className="btn" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="btn" type="button" onClick={onOpenFile}>
              <FileText size={12} /> Open file
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => {
                onSave(content);
                onClose();
              }}
            >
              <Save size={12} /> Save schematic
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
