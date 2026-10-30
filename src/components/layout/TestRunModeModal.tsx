import { useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical, Loader2, Square, X } from "lucide-react";

import {
  nativeProviderCatalog,
  type ChatModelDefault,
  type NativeProviderCatalog,
} from "../../lib/native-chat";
import { readModelRecency } from "../../lib/modelRecency";
import { ModalPortal } from "../ModalPortal";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { LoadingBlock } from "./Loading";
import { t } from "../../i18n";

type TestRunModeModalProps = {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen model. The modal stays open and streams progress
   *  via `logs` / `running` until the user closes or cancels. */
  onRun: (model: ChatModelDefault) => void;
  /** Cancel the in-progress test run. Stops the agent and cleans up. */
  onCancel: () => void;
  /** Progress log lines streamed from the test run handler. */
  logs: string[];
  /** True while the test run is in progress. */
  running: boolean;
};

type ModelEntry = {
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  configured: boolean;
  lastUsed: number;
};

export function TestRunModeModal({ open, onClose, onRun, onCancel, logs, running }: TestRunModeModalProps) {
  const [catalog, setCatalog] = useState<NativeProviderCatalog | null>(null);
  // Starts true and is re-armed on close so the first render after the modal
  // opens never claims "No providers available" before the fetch runs.
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [modelChoice, setModelChoice] = useState<string>("");
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEscapeKey(open, onClose);

  useEffect(() => {
    if (!open) {
      setCatalog(null);
      setModelChoice("");
      setCatalogLoading(true);
      return;
    }
    // Fetch the provider catalog to populate the model dropdown.
    void nativeProviderCatalog()
      .then(setCatalog)
      .catch(() => {
        // Catalog unavailable — falls through to the "no providers" notice.
      })
      .finally(() => setCatalogLoading(false));
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
    if (running) return;
    const model = chosenModel();
    if (!model) return;
    onRun(model);
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

  // Auto-scroll the log terminal to the bottom when new lines arrive.
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollTop = logEndRef.current.scrollHeight;
    }
  }, [logs]);

  if (!open) return null;

  const hasModels = sortedModels.length > 0;
  const selectedEntry = sortedModels.find((m) => `${m.providerId}\u0000${m.modelId}` === modelChoice);
  const selectedConfigured = selectedEntry?.configured ?? false;

  return (
    <ModalPortal>
      <div className="modal-overlay" role="dialog" aria-label={t("testRunModeModal.testRunMode")} onClick={onClose}>
        <div className="modal destination-picker-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2><FlaskConical size={14} /> {t("testRunModeModal.testRunMode")}</h2>
            <button
              className="btn-icon"
              type="button"
              title={t("testRunModeModal.closeEsc")}
              aria-label={t("testRunModeModal.close")}
              onClick={onClose}
            >
              <X size={14} />
            </button>
          </div>
          <div className="modal-body destination-picker-body">
            <p className="text-muted text-sm pad">
              {t("testRunModeModal.initializesAMinimalTestProject")} <code>{t("testRunModeModal.indexHtml")}</code>{t("testRunModeModal.andRunsTheFullPlan")}
            </p>
            {catalogLoading ? (
              <LoadingBlock label={t("testRunModeModal.loadingModelCatalog")} compact />
            ) : hasModels ? (
              <div className="destination-picker-model">
                <label className="form-label text-sm" htmlFor="test-run-model-select">
                  {t("testRunModeModal.providerModel")} <span className="text-danger">*</span>
                </label>
                <select
                  id="test-run-model-select"
                  className="input destination-picker-model-select"
                  value={modelChoice}
                  title={t("testRunModeModal.pickTheProviderAndModel")}
                  onChange={(e) => setModelChoice(e.target.value)}
                  disabled={running}
                >
                  {groupedModels.map((group) => (
                    <optgroup
                      key={group.providerId}
                      label={t((group.configured ? "testRunModeModal.text.empty" : "testRunModeModal.text.notAuthenticated"), { providerLabel: group.providerLabel })}
                    >
                      {group.models.map((model) => (
                        <option
                          key={`${model.providerId}\u0000${model.modelId}`}
                          value={`${model.providerId}\u0000${model.modelId}`}
                        >
                          {model.modelLabel}{model.lastUsed > 0 ? t("testRunModeModal.recent") : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {selectedEntry && !selectedConfigured ? (
                  <span className="destination-picker-model-note text-danger">
                    {t("testRunModeModal.isNotAuthenticatedConfigureIt", { providerLabel: selectedEntry.providerLabel })}
                  </span>
                ) : (
                  <span className="destination-picker-model-note text-muted">
                    {t("testRunModeModal.sortedByRecentlyUsedThen")}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-danger text-sm pad">
                {t("testRunModeModal.noProvidersAvailableConfigureA")}
              </p>
            )}

            {/* Terminal-style progress log — shown once the run starts. */}
            {logs.length > 0 ? (
              <div className="test-run-log-wrap">
                <div className="test-run-log-header text-xs text-muted">
                  {running ? t("testRunModeModal.progress") : t("testRunModeModal.log")}
                </div>
                <div className="test-run-log" ref={logEndRef}>
                  {logs.map((line, i) => (
                    <div key={i} className="test-run-log-line">
                      <span className="test-run-log-line-text">{line}</span>
                    </div>
                  ))}
                  {running ? (
                    <div className="test-run-log-line test-run-log-line-busy">
                      <Loader2 size={11} className="is-spinning" />
                      <span className="test-run-log-line-text">{t("testRunModeModal.working")}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <div className="modal-actions">
            {running ? (
              <button
                className="btn btn-danger"
                type="button"
                title={t("testRunModeModal.stopTheAgentAndCancel")}
                onClick={onCancel}
              >
                <Square size={12} /> {t("testRunModeModal.cancelRun")}
              </button>
            ) : (
              <button className="btn" type="button" title={t("testRunModeModal.close")} onClick={onClose}>
                {t("testRunModeModal.close")}
              </button>
            )}
            <button
              className="btn btn-primary"
              type="button"
              title={running ? t("testRunModeModal.running") : t("testRunModeModal.initializeOrReuseTheTest")}
              onClick={handleRun}
              disabled={running || !hasModels || !modelChoice || !selectedConfigured}
            >
              {running ? <Loader2 size={12} className="is-spinning" /> : null}
              {running ? t("testRunModeModal.running") : t("testRunModeModal.initializeRun")}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
