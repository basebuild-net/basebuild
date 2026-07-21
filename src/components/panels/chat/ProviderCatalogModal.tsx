import { type Dispatch, type SetStateAction } from "react";
import { AlertCircle, AlertTriangle, Check, Link, Loader2, Plug, RefreshCw, Search, Settings2, X } from "lucide-react";
import { ModalPortal } from "../../ModalPortal";
import { formatRelativeTime } from "../../../lib/timing";
import { recordModelUse, recordProviderUse } from "../../../lib/modelRecency";
import { nativeProviderCatalogRefresh } from "../../../lib/native-chat";
import type {
  NativeModel,
  NativeProvider,
  NativeProviderCatalog,
  NativeSetupRequired,
} from "../../../lib/native-chat";
import type { LogLevel } from "../../../state/log";
import { CONNECTED_VIA_LABELS, LOCAL_PROVIDER_ID, modelDetection, providerAuthOptionsLabel } from "./chatFormat";

type CatalogStatus = "loading" | "refreshing" | "ready" | "stale" | "error";

type ProviderCatalogModalProps = {
  catalog: NativeProviderCatalog | null;
  catalogStatus: CatalogStatus;
  catalogError: string | null;
  connectedProviders: NativeProvider[];
  providerFilter: string;
  setProviderFilter: Dispatch<SetStateAction<string>>;
  visibleCatalogProviders: NativeProvider[];
  providerId: string;
  setProviderId: Dispatch<SetStateAction<string>>;
  setProviderRecency: Dispatch<SetStateAction<Record<string, number>>>;
  modelId: string;
  setModelId: Dispatch<SetStateAction<string>>;
  setModelRecency: Dispatch<SetStateAction<Record<string, number>>>;
  modelFilter: string;
  setModelFilter: Dispatch<SetStateAction<string>>;
  selectedProvider: NativeProvider | null;
  filteredModels: NativeModel[];
  modelRecency: Record<string, number>;
  effortLevel: string;
  persistSelection: (providerId: string, modelId: string, effort: string) => void;
  setSetupRequired: Dispatch<SetStateAction<NativeSetupRequired | null>>;
  setModelNotice: Dispatch<SetStateAction<string | null>>;
  setShowProviderPicker: Dispatch<SetStateAction<boolean>>;
  setShowModelPicker: Dispatch<SetStateAction<boolean>>;
  setLoginError: Dispatch<SetStateAction<string | null>>;
  setManagedProviderId: Dispatch<SetStateAction<string | null>>;
  setShowLogin: Dispatch<SetStateAction<boolean>>;
  refreshCatalog: (force?: boolean, targetProviderId?: string) => Promise<NativeProviderCatalog | null>;
  addLog: (level: LogLevel, message: string, details?: string) => void;
};

export function ProviderCatalogModal({
  catalog,
  catalogStatus,
  catalogError,
  connectedProviders,
  providerFilter,
  setProviderFilter,
  visibleCatalogProviders,
  providerId,
  setProviderId,
  setProviderRecency,
  modelId,
  setModelId,
  setModelRecency,
  modelFilter,
  setModelFilter,
  selectedProvider,
  filteredModels,
  modelRecency,
  effortLevel,
  persistSelection,
  setSetupRequired,
  setModelNotice,
  setShowProviderPicker,
  setShowModelPicker,
  setLoginError,
  setManagedProviderId,
  setShowLogin,
  refreshCatalog,
  addLog,
}: ProviderCatalogModalProps) {
  return (
              <ModalPortal>
              <div
                className="modal-overlay provider-catalog-overlay"
                role="dialog"
                aria-label="Provider and model catalog"
                onClick={() => {
                  addLog("debug", "Provider catalog modal closed", "overlay");
                  setShowProviderPicker(false);
                  setShowModelPicker(false);
                }}
              >
                <div className="modal provider-catalog-modal" onClick={(event) => event.stopPropagation()}>
                  <div className="modal-header">
                    <div className="provider-catalog-title">
                      <h2>Provider &amp; model</h2>
                      <span>
                        {catalogStatus === "loading" || catalogStatus === "refreshing"
                          ? `${catalog ? "Refreshing" : "Loading"} provider catalog…`
                          : catalogStatus === "error"
                            ? "Catalog unavailable"
                            : catalogStatus === "stale"
                              ? `Refresh failed · showing ${catalog?.models.length ?? 0} cached models`
                              : `${connectedProviders.length} connected · ${catalog?.providers.length ?? 0} providers · ${catalog?.models.length ?? 0} models`}
                      </span>
                    </div>
                    <button
                      className="btn-icon"
                      type="button"
                      title="Close provider and model catalog"
                      onClick={() => {
                        addLog("debug", "Provider catalog modal closed", "button");
                        setShowProviderPicker(false);
                        setShowModelPicker(false);
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {catalog ? (
                  <div className="provider-catalog-body">
                    <section className="provider-catalog-providers" aria-label="Providers">
                      <div className="provider-catalog-section-heading">
                        <span>Providers</span>
                        <span className="text-muted">Select one to browse its models</span>
                      </div>
                      <div className="provider-search-wrap">
                        <Search size={12} className="provider-search-icon" />
                        <input
                          className="input provider-search-input"
                          type="search"
                          placeholder="Search providers and models…"
                          value={providerFilter}
                          onChange={(event) => setProviderFilter(event.target.value)}
                          title="Search providers and models"
                        />
                      </div>
                      <div className="provider-card-grid">
                        {visibleCatalogProviders.map((provider) => {
                          const isLocal = provider.id === LOCAL_PROVIDER_ID;
                          const healthBad = provider.accountCount > 0 && provider.aggregateHealth !== "healthy";
                          const needsBaseUrl = provider.status === "transport_unavailable";
                          // Auth badge: account count first, then auth method.
                          const authBadge = isLocal
                            ? null
                            : provider.accountCount > 0
                              ? `${provider.accountCount} ${provider.accountCount === 1 ? "account" : "accounts"}`
                              : provider.authMethod === "oauth"
                                ? provider.apiKeyUrl ? "OAuth / API key" : "OAuth"
                                : "API key";
                          return (
                          <div
                            key={provider.id}
                            className={`provider-card is-${provider.configured ? "connected" : "available"}${provider.id === providerId ? " is-active" : ""}${isLocal ? " is-local" : ""}`}
                            title={`${provider.label}: ${provider.configured ? "connected" : "not connected"}; ${provider.modelCount} models`}
                          >
                            <button
                              className="provider-card-select"
                              type="button"
                              title={`${provider.label}: ${provider.configured ? "connected" : "not connected"}; ${provider.modelCount} models. Click to browse models.`}
                              onClick={() => {
                                addLog("debug", "Provider selected", `provider=${provider.id}; connected=${provider.configured}`);
                                setProviderId(provider.id);
                                setProviderRecency(recordProviderUse(provider.id));
                                const providerModels = catalog.models.filter((model) => model.providerId === provider.id);
                                const currentIsValid = providerModels.some((model) => model.id === modelId);
                                if (!currentIsValid && providerModels[0]) setModelId(providerModels[0].id);
                                setSetupRequired(null);
                                setModelFilter("");
                              }}
                            >
                              <span className="provider-card-name">
                                {isLocal ? <Plug size={11} className="provider-card-icon" /> : provider.configured ? <Check size={11} className="provider-card-icon is-ok" /> : <Link size={11} className="provider-card-icon" />}
                                {provider.label}
                              </span>
                              <span className="provider-card-middle">
                                {authBadge ? <span className="provider-card-auth" title={providerAuthOptionsLabel(provider) || authBadge}>{authBadge}</span> : null}
                                <span className="provider-card-meta">
                                  {provider.modelCount} models
                                  {provider.connectedVia ? ` · ${CONNECTED_VIA_LABELS[provider.connectedVia]}` : ""}
                                </span>
                                {needsBaseUrl ? (
                                  <span className="provider-card-flag is-warn" title="This provider uses a bespoke API that requires a custom base URL for native chat. Set a base URL to enable the native agent loop.">
                                    <AlertTriangle size={10} /> Needs base URL
                                  </span>
                                ) : null}
                                {healthBad ? (
                                  <span
                                    className={`provider-card-flag is-${provider.aggregateHealth === "broken" ? "danger" : "warn"}`}
                                    title={`Account health: ${provider.aggregateHealth}. Open Manage for per-account details.`}
                                  >
                                    <AlertTriangle size={10} /> {provider.aggregateHealth === "broken" ? "Needs attention" : "Degraded"}
                                  </span>
                                ) : null}
                                {provider.error ? (
                                  <span className="provider-card-error-text text-danger" title={provider.error}>
                                    {provider.error}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                            <span className="provider-card-actions">
                              {isLocal ? (
                                <span className="provider-card-local-tag" title="No provider connected — select a provider to chat.">Local</span>
                              ) : (
                                <button
                                  className="btn btn-sm provider-card-action-btn"
                                  type="button"
                                  title={`Manage ${provider.label} accounts and API keys`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowProviderPicker(false);
                                    setShowModelPicker(false);
                                    setLoginError(null);
                                    setManagedProviderId(provider.id);
                                    setShowLogin(true);
                                  }}
                                >
                                  <Settings2 size={11} /> Manage
                                </button>
                              )}
                              {provider.error ? (
                                <button
                                  className="btn btn-sm provider-card-retry-btn"
                                  type="button"
                                  title={`Retry fetching models from ${provider.label}`}
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      await nativeProviderCatalogRefresh({ providerId: provider.id, force: true });
                                      await refreshCatalog();
                                    } catch (err) {
                                      addLog("error", "Failed to refresh provider", err instanceof Error ? err.message : String(err));
                                    }
                                  }}
                                >
                                  Retry
                                </button>
                              ) : null}
                            </span>
                          </div>
                          );
                        })}
                        {visibleCatalogProviders.length === 0 ? (
                          <p className="text-muted text-sm">No providers or models match your search.</p>
                        ) : null}
                      </div>
                    </section>
                    <section className="provider-catalog-models" aria-label="Models">
                      <div className="provider-catalog-section-heading">
                        <span>{selectedProvider?.label ?? providerId} models</span>
                        <span className={`provider-status is-${selectedProvider?.configured ? "connected" : "available"}`}>
                          <span className="provider-status-dot" />
                          {selectedProvider?.configured ? "Connected" : "Not connected"}
                        </span>
                      </div>
                      <input
                        className="input provider-model-search"
                        value={modelFilter}
                        placeholder="Search this provider's models"
                        title="Filter models for the selected provider by id or label"
                        onChange={(event) => setModelFilter(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setShowProviderPicker(false);
                            setShowModelPicker(false);
                          }
                        }}
                      />
                      <div className="provider-model-list">
                        {filteredModels.map((model) => { const detection = modelDetection(model); return (
                          <button
                            key={`${model.providerId}:${model.id}`}
                            className={`provider-model-row${model.id === modelId && model.providerId === providerId ? " is-active" : ""}`}
                            type="button"
                            title={`${selectedProvider?.label ?? model.providerId} / ${model.id}. ${detection.tooltip}`}
                            onClick={() => {
                              addLog("debug", "Model selected", `provider=${model.providerId}; model=${model.id}`);
                              setProviderId(model.providerId);
                              setModelId(model.id);
                              setModelRecency(recordModelUse(model.providerId, model.id));
                              setShowProviderPicker(false);
                              setShowModelPicker(false);
                              setSetupRequired(null);
                              setModelNotice(null);
                              persistSelection(model.providerId, model.id, effortLevel);
                            }}
                          >
                            <span className="provider-model-main">
                              <span>{model.label}</span>
                              <span className="provider-model-id">{model.id}</span>
                            </span>
                            <span className="provider-model-badges">
                              {modelRecency[`${model.providerId}/${model.id}`] ? (
                                <span className="provider-model-recency" title="Last used">
                                  used {formatRelativeTime(modelRecency[`${model.providerId}/${model.id}`]!)}
                                </span>
                              ) : null}
                              {detection.live ? (
                                <span className="provider-capability is-positive" title={detection.tooltip}>
                                  <Check size={11} aria-hidden="true" /> Detected
                                </span>
                              ) : null}
                              {model.supportsTools ? <span className="provider-capability is-positive">Tools</span> : null}
                              {model.supportsReasoning ? <span className="provider-capability">Reasoning</span> : null}
                              <span className="provider-capability">{model.supportedEfforts.length ? model.supportedEfforts.join("/") : "Standard"}</span>
                            </span>
                          </button>
                        ); })}
                        {filteredModels.length === 0 ? <p className="text-muted text-sm provider-model-empty">No matching models.</p> : null}
                      </div>
                    </section>
                  </div>
                  ) : catalogStatus === "error" ? (
                    <div className="modal-loading" role="alert">
                      <AlertCircle size={20} />
                      <span>Provider catalog could not load.</span>
                      <span className="text-muted text-sm">{catalogError ?? "Unknown catalog error"}</span>
                      <button
                        className="btn btn-sm btn-primary"
                        type="button"
                        title="Retry loading the provider catalog"
                        onClick={() => void refreshCatalog()}
                      >
                        <RefreshCw size={12} /> Retry
                      </button>
                    </div>
                  ) : (
                    <div className="modal-loading" role="status" aria-live="polite">
                      <Loader2 size={20} className="spin" />
                      <span>Loading provider catalog…</span>
                    </div>
                  )}
                </div>
              </div>
              </ModalPortal>
  );
}
