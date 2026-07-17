import { useEffect, useMemo, useState } from "react";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { Cpu, Loader2, MessageSquare, Plus, X } from "lucide-react";
import type { Panel } from "../../lib/panelGrid";
import {
  nativeChatBootstrap,
  nativeChatGet,
  type ChatModelDefault,
  type NativeProviderCatalog,
  type ResolvedChatModelDefault,
} from "../../lib/native-chat";
import { ModalPortal } from "../ModalPortal";

export type DestinationChoice =
  | { kind: "existing"; chatSessionId: string; panelId: string; model?: ChatModelDefault | null }
  | { kind: "new"; model?: ChatModelDefault | null };

type ChatPanelInfo = {
  panelId: string;
  title: string;
  chatSessionId: string | null;
};

type DestinationPickerProps = {
  open: boolean;
  onClose: () => void;
  /** May return a promise — the picker shows a busy state until it settles. */
  onSelect: (choice: DestinationChoice) => void | Promise<unknown>;
  /** Flattened chat panels from the grid. */
  panels: Panel[];
  /** Title for the picker dialog. */
  title?: string;
  /** Project path — enables the model confirmation section. */
  projectPath?: string | null;
  /** "assign" honors a model override for new conversations; "deliver" keeps
   *  the existing new-chat machinery (project default). */
  mode?: "deliver" | "assign";
};

/** Sentinel for "keep the destination's current / default model". */
const MODEL_AUTO = "auto";

export function DestinationPicker({
  open,
  onClose,
  onSelect,
  panels,
  title = "Choose destination",
  projectPath = null,
  mode = "deliver",
}: DestinationPickerProps) {
  const [busy, setBusy] = useState(false);
  useEscapeKey(open && !busy, onClose);
  const [selected, setSelected] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<NativeProviderCatalog | null>(null);
  const [resolvedDefault, setResolvedDefault] = useState<ResolvedChatModelDefault | null>(null);
  const [modelChoice, setModelChoice] = useState<string>(MODEL_AUTO);
  // Current model of the selected existing chat (fetched on selection).
  const [sessionModel, setSessionModel] = useState<{ providerId: string; modelId: string; effortLevel: string } | null>(null);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setModelChoice(MODEL_AUTO);
      setSessionModel(null);
      setBusy(false);
    }
  }, [open]);

  // Load the provider catalog + project model default once per open.
  useEffect(() => {
    if (!open || !projectPath) return;
    let cancelled = false;
    void nativeChatBootstrap(projectPath)
      .then((bootstrap) => {
        if (cancelled) return;
        setCatalog(bootstrap.catalog);
        setResolvedDefault(bootstrap.resolved);
      })
      .catch(() => {
        // No catalog (e.g. providers not set up) — hide the model section.
        if (!cancelled) {
          setCatalog(null);
          setResolvedDefault(null);
        }
      });
    return () => { cancelled = true; };
  }, [open, projectPath]);

  const chatPanels: ChatPanelInfo[] = panels
    .filter((p) => p.type === "chat")
    .map((p) => ({ panelId: p.id, title: p.title, chatSessionId: p.chatSessionId }));

  // Resolve the selected existing chat's current model so the confirmation
  // shows what will actually run when the user keeps "current model".
  const selectedPanel = chatPanels.find((p) => p.panelId === selected) ?? null;
  useEffect(() => {
    const chatSessionId = selectedPanel?.chatSessionId;
    if (!chatSessionId) {
      setSessionModel(null);
      return;
    }
    let cancelled = false;
    void nativeChatGet(chatSessionId)
      .then((session) => {
        if (!cancelled) {
          setSessionModel(
            session
              ? { providerId: session.providerId, modelId: session.modelId, effortLevel: session.effortLevel }
              : null,
          );
        }
      })
      .catch(() => { if (!cancelled) setSessionModel(null); });
    return () => { cancelled = true; };
  }, [selectedPanel?.chatSessionId]);

  const modelsByProvider = useMemo(() => {
    if (!catalog) return [];
    return catalog.providers
      .filter((provider) => provider.configured)
      .map((provider) => ({
        provider,
        models: catalog.models.filter((m) => m.providerId === provider.id),
      }))
      .filter((group) => group.models.length > 0);
  }, [catalog]);

  if (!open) return null;

  // The model used when the user keeps "auto": the selected chat's current
  // model, else the resolved project default.
  const autoModel = selected !== "new" && sessionModel ? sessionModel : resolvedDefault;
  const autoLabel = selected !== "new" && sessionModel
    ? `Chat's current model (${sessionModel.modelId})`
    : resolvedDefault
      ? `Project default (${resolvedDefault.modelId})`
      : "Project default";
  // Deliver-mode new chats go through the transactional panel-create path,
  // which always starts on the project default — no override there.
  const modelOverrideDisabled = mode === "deliver" && selected === "new";
  const confirmLabel = mode === "assign" ? "Assign" : "Deliver";

  function chosenModel(): ChatModelDefault | null {
    if (modelOverrideDisabled || modelChoice === MODEL_AUTO || !catalog) return null;
    const sep = modelChoice.indexOf("\u0000");
    if (sep < 0) return null;
    const providerId = modelChoice.slice(0, sep);
    const modelId = modelChoice.slice(sep + 1);
    // Keep the effort the destination already uses; fall back to the default.
    const effortLevel = autoModel?.effortLevel ?? catalog.defaultEffortLevel;
    return { providerId, modelId, effortLevel };
  }

  function handleConfirm() {
    if (busy) return;
    let choice: DestinationChoice | null = null;
    if (selected === "new") {
      choice = { kind: "new", model: chosenModel() };
    } else if (selected) {
      const panel = chatPanels.find((p) => p.panelId === selected);
      if (panel?.chatSessionId) {
        choice = { kind: "existing", chatSessionId: panel.chatSessionId, panelId: panel.panelId, model: chosenModel() };
      }
    }
    if (!choice) {
      onClose();
      return;
    }
    const result = onSelect(choice);
    if (result && typeof (result as Promise<unknown>).finally === "function") {
      // Async destination work (e.g. plan assignment) — keep the picker up
      // with a busy indicator until it settles, then close.
      setBusy(true);
      void (result as Promise<unknown>).finally(() => {
        setBusy(false);
        onClose();
      });
    } else {
      onClose();
    }
  }

  return (
    <ModalPortal>
    <div className="modal-overlay" role="dialog" aria-label={title} onClick={busy ? undefined : onClose}>
      <div className="modal destination-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="btn-icon" type="button" title="Close (Esc)" aria-label="Close" onClick={onClose} disabled={busy}>
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
                title={mode === "assign" ? "Create a new chat and assign the plan to it" : "Create a new chat panel for this prompt"}
                onClick={() => setSelected("new")}
              >
                <Plus size={14} className="destination-picker-item-icon" />
                <span className="destination-picker-item-label">New conversation</span>
              </button>
            </li>
          </ul>
          {catalog && selected ? (
            <div className="destination-picker-model">
              <label className="destination-picker-model-label" htmlFor="destination-picker-model-select">
                <Cpu size={11} />
                Model
              </label>
              <select
                id="destination-picker-model-select"
                className="input destination-picker-model-select"
                value={modelOverrideDisabled ? MODEL_AUTO : modelChoice}
                disabled={modelOverrideDisabled}
                title={
                  modelOverrideDisabled
                    ? "New chats start with the project default model — change it from the chat composer"
                    : "Confirm or change the model used at this destination"
                }
                onChange={(e) => setModelChoice(e.target.value)}
              >
                <option value={MODEL_AUTO}>{autoLabel}</option>
                {modelsByProvider.map(({ provider, models }) => (
                  <optgroup key={provider.id} label={provider.label}>
                    {models.map((model) => (
                      <option key={`${provider.id}\u0000${model.id}`} value={`${provider.id}\u0000${model.id}`}>
                        {model.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {modelOverrideDisabled ? (
                <span className="destination-picker-model-note text-muted">
                  New chats start with the project default; change it in the composer.
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="modal-actions">
          <button className="btn" type="button" title="Cancel — deliver nothing" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            type="button"
            title={
              busy
                ? (mode === "assign" ? "Assigning the plan…" : "Delivering…")
                : selected
                  ? "Deliver prompt to the selected destination"
                  : "Pick a destination first"
            }
            onClick={handleConfirm}
            disabled={!selected || busy}
          >
            {busy ? <Loader2 size={12} className="is-spinning" /> : null}
            {busy ? (mode === "assign" ? "Assigning…" : "Sending…") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
