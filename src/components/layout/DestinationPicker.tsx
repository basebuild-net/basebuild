import { useEffect, useState } from "react";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { MessageSquare, Plus, X } from "lucide-react";
import type { Panel } from "../../lib/panelGrid";

export type DestinationChoice =
  | { kind: "existing"; chatSessionId: string; panelId: string }
  | { kind: "new" };

type ChatPanelInfo = {
  panelId: string;
  title: string;
  chatSessionId: string | null;
};

type DestinationPickerProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (choice: DestinationChoice) => void;
  /** Flattened chat panels from the grid. */
  panels: Panel[];
  /** Title for the picker dialog. */
  title?: string;
};

export function DestinationPicker({
  open,
  onClose,
  onSelect,
  panels,
  title = "Choose destination",
}: DestinationPickerProps) {
  useEscapeKey(open, onClose);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setSelected(null);
  }, [open]);

  if (!open) return null;

  const chatPanels: ChatPanelInfo[] = panels
    .filter((p) => p.type === "chat")
    .map((p) => ({ panelId: p.id, title: p.title, chatSessionId: p.chatSessionId }));

  function handleConfirm() {
    if (selected === "new") {
      onSelect({ kind: "new" });
    } else if (selected) {
      const panel = chatPanels.find((p) => p.panelId === selected);
      if (panel?.chatSessionId) {
        onSelect({ kind: "existing", chatSessionId: panel.chatSessionId, panelId: panel.panelId });
      }
    }
    onClose();
  }

  return (
    <div className="modal-overlay" role="dialog" aria-label={title} onClick={onClose}>
      <div className="modal destination-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="btn-icon" type="button" title="Close (Esc)" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body destination-picker-body">
          <ul className="destination-picker-list" role="listbox">
            {chatPanels.length === 0 ? (
              <li className="destination-picker-empty text-muted text-sm">
                No open chat panels.
              </li>
            ) : null}
            {chatPanels.map((panel) => (
              <li key={panel.panelId} role="option" aria-selected={selected === panel.panelId}>
                <button
                  className={`destination-picker-item ${selected === panel.panelId ? "selected" : ""}`}
                  type="button"
                  title={`Send to ${panel.title}${panel.chatSessionId ? ` (session ${panel.chatSessionId.slice(-6)})` : " (no session yet)"}`}
                  onClick={() => setSelected(panel.panelId)}
                  disabled={!panel.chatSessionId}
                >
                  <MessageSquare size={14} className="destination-picker-item-icon" />
                  <span className="destination-picker-item-label">{panel.title}</span>
                  {!panel.chatSessionId ? (
                    <span className="destination-picker-item-badge text-muted text-sm">initializing…</span>
                  ) : null}
                </button>
              </li>
            ))}
            <li className="destination-picker-divider" aria-hidden="true" />
            <li role="option" aria-selected={selected === "new"}>
              <button
                className={`destination-picker-item ${selected === "new" ? "selected" : ""}`}
                type="button"
                title="Create a new chat panel for this prompt"
                onClick={() => setSelected("new")}
              >
                <Plus size={14} className="destination-picker-item-icon" />
                <span className="destination-picker-item-label">New conversation</span>
              </button>
            </li>
          </ul>
        </div>
        <div className="modal-actions">
          <button className="btn" type="button" title="Cancel — deliver nothing" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            type="button"
            title={selected ? "Deliver prompt to the selected destination" : "Pick a destination first"}
            onClick={handleConfirm}
            disabled={!selected}
          >
            Deliver
          </button>
        </div>
      </div>
    </div>
  );
}
