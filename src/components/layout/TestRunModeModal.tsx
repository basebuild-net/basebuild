import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Loader2, X } from "lucide-react";

import {
  nativeProviderCatalog,
  type ChatModelDefault,
  type NativeProviderCatalog,
} from "../../lib/native-chat";
import { readModelRecency } from "../../lib/modelRecency";
import { ModalPortal } from "../ModalPortal";
import { useEscapeKey } from "../../lib/useEscapeKey";

type TestRunModeModalProps = {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen model. The modal shows a busy state until the
   *  returned promise settles, then closes. The user MUST pick a model —
   *  there is no "default" fallback, to avoid silently using a broken
   *  provider. */
  onRun: (model: ChatModelDefault) => void | Promise<unknown>;
};

type ModelEntry = {
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  configured: boolean;
  lastUsed: number;
};

export function TestRunModeModal({ open, onClose, onRun }: TestRunModeModalProps) {
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<NativeProviderCatalog | null>(null);
  const [modelChoice, setModelChoice] = useState<string>("");

  useEscapeKey(open && !busy, onClose);

  useEffect(() => {
    if (!open) {
      setCatalog(null);
      setModelChoice("");
      setBusy(false);
      return;
    }
    // Fetch the provider catalog to populate the model dropdown.
    void nativeProviderCatalog().then(setCatalog).catch(() => {
      // Catalog unavailable — user can't run.
    });
  }, [open]);

  /** Flat list of all models across all providers, annotated with
   *  configured status and last-used timestamp for sorting. */
  const allModels = useMemo<ModelEntry[]>(() => {
    if (!catalog) return [];
    const recency = readModelRecency();
    return catalog.models.map((model) => {
      const provider = catalog.providers.find((p) => p.id === model.providerId);
      return {
        providerId: model.providerId,
        providerLabel: provider?.label ?? model.providerId,
        modelId: model.id,
        modelLabel: model.label,
        configured: provider?.configured ?? false,
        lastUsed: recency[`${model.providerId}/${model.id}`] ?? 0,
      };
    });
  }, [catalog]);

  /** Models sorted by: recently used first, then configured first, then
   *  provider label, then model label. */
  const sortedModels = useMemo(() => {
    return [...allModels].sort((a, b) => {
      // Recently used first (descending timestamp).
      if (a.lastUsed !== b.lastUsed) return b.lastUsed - a.lastUsed;
      // Configured providers before unconfigured.
      if (a.configured !== b.configured) return Number(b.configured) - Number(a.configured);
      // Then by provider label.
      const pCmp = a.providerLabel.localeCompare(b.providerLabel);
      if (pCmp !== 0) return pCmp;
      // Then by model label.
      return a.modelLabel.localeCompare(b.modelLabel);
    });
  }, [allModels]);

  /** Group sorted models by provider for the <optgroup> layout, preserving
   *  the sort order (the first model a provider appears with determines its
   *  position in the dropdown). */
  const groupedModels = useMemo(() => {
    const groups: { providerId: string; providerLabel: string; configured: boolean; models: ModelEntry[] }[] = [];
    for (const entry of sortedModels) {
      let group = groups.find((g) => g.providerId === entry.providerId);
      if (!group) {
        group = { providerId: entry.providerId, providerLabel: entry.providerLabel, configured: entry.configured, models: [] };
        groups.push(group);
      }
      group.models.push(entry);
    }
    return groups;
  }, [sortedModels]);

  if (!open) return null;

  const hasModels = sortedModels.length > 0;
  const selectedEntry = sortedModels.find((m) => `${m.providerId}\u0000${m.modelId}` === modelChoice);
  const selectedConfigured = selectedEntry?.configured ?? false;

  function chosenModel(): ChatModelDefault | null {
    if (!modelChoice || !catalog) return null;
    const sep = modelChoice.indexOf("\u0000");
    if (sep < 0) return null;
    const providerId = modelChoice.slice(0, sep);
    const modelId = modelChoice.slice(sep + 1);
    const effortLevel = catalog.defaultEffortLevel;
    return { providerId, modelId, effortLevel };
  }

  function handleRun() {
    if (busy) return;
    const model = chosenModel();
    if (!model) return;
    const result = onRun(model);
    if (result && typeof (result as Promise<unknown>).finally === "function") {
      setBusy(true);
      void (result as Promise<unknown>).finally(() => {
        setBusy(false);
        onClose();
      });
    } else {
      onClose();
    }
  }

  // Auto-select the most recently used configured model, or the first
  // configured model if there's no recency. Falls back to the first model
  // overall if nothing is configured (so the user sees the auth warning).
  useEffect(() => {
    if (!catalog || sortedModels.length === 0 || modelChoice) return;
    const recentConfigured = sortedModels.find((m) => m.configured && m.lastUsed > 0);
    const firstConfigured = sortedModels.find((m) => m.configured);
    const pick = recentConfigured ?? firstConfigured ?? sortedModels[0];
    if (pick) setModelChoice(`${pick.providerId}\u0000${pick.modelId}`);
  }, [catalog, sortedModels, modelChoice]);

  return (
    <ModalPortal>
      <div className="modal-overlay" role="dialog" aria-label="Test Run Mode" onClick={busy ? undefined : onClose}>
        <div className="modal destination-picker-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2><FlaskConical size={14} /> Test Run Mode</h2>
            <button
              className="btn-icon"
              type="button"
              title="Close (Esc)"
              aria-label="Close"
              onClick={onClose}
              disabled={busy}
            >
              <X size={14} />
            </button>
          </div>
          <div className="modal-body destination-picker-body">
            <p className="text-muted text-sm pad">
              Initializes a minimal test project (empty folder + <code>index.html</code>) and runs the
              full plan lifecycle: create idea → promote → openspec → approve → run → finished.
              If the test project already exists, it is reused.
            </p>
            {catalog ? (
              hasModels ? (
                <div className="destination-picker-model">
                  <label className="form-label text-sm" htmlFor="test-run-model-select">
                    Provider / Model <span className="text-danger">*</span>
                  </label>
                  <select
                    id="test-run-model-select"
                    className="input destination-picker-model-select"
                    value={modelChoice}
                    title="Pick the provider and model for OpenSpec generation and the plan run. Sorted by recently used, then configured first."
                    onChange={(e) => setModelChoice(e.target.value)}
                  >
                    {groupedModels.map((group) => (
                      <optgroup
                        key={group.providerId}
                        label={`${group.providerLabel} ${group.configured ? "✓" : "(not authenticated)"}`}
                      >
                        {group.models.map((model) => (
                          <option
                            key={`${model.providerId}\u0000${model.modelId}`}
                            value={`${model.providerId}\u0000${model.modelId}`}
                          >
                            {model.modelLabel}{model.lastUsed > 0 ? " · recent" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {selectedEntry && !selectedConfigured ? (
                    <span className="destination-picker-model-note text-danger">
                      {selectedEntry.providerLabel} is not authenticated. Configure it in Settings before running, or pick a connected provider.
                    </span>
                  ) : (
                    <span className="destination-picker-model-note text-muted">
                      Sorted by recently used, then configured first. Pick a connected provider (✓).
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-danger text-sm pad">
                  No providers available. Configure a provider in Settings before running Test Run Mode.
                </p>
              )
            ) : (
              <p className="text-muted text-sm">Loading model catalog…</p>
            )}
          </div>
          <div className="modal-actions">
            <button className="btn" type="button" title="Cancel" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              type="button"
              title={busy ? "Running…" : "Initialize (or reuse) the test project and run the full plan lifecycle"}
              onClick={handleRun}
              disabled={busy || !hasModels || !modelChoice || !selectedConfigured}
            >
              {busy ? <Loader2 size={12} className="is-spinning" /> : null}
              {busy ? "Running…" : "Initialize & Run"}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
