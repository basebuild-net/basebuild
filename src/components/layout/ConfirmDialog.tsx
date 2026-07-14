import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { ModalPortal } from "../ModalPortal";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <ModalPortal>
    <div className="modal-overlay" role="dialog" aria-label={title} onClick={onCancel}>
      <div className="modal confirm-dialog-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
        </div>
        <div className="modal-body">
          <div className="confirm-dialog-message">
            {destructive ? <AlertTriangle size={16} className="confirm-dialog-icon" /> : null}
            <span>{message}</span>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn" type="button" title={cancelLabel} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`btn ${destructive ? "btn-danger" : "btn-primary"}`}
            type="button"
            title={confirmLabel}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
