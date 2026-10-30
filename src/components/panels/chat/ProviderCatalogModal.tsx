import { Fragment, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { AlertCircle, AlertTriangle, Check, Link, Loader2, Plug, RefreshCw, Search, Settings2, X } from "lucide-react";
import { ModalPortal } from "../../ModalPortal";
import { OptionList, type OptionListOption } from "../../layout/OptionList";
import { SkeletonRows } from "../../layout/Loading";
import { formatRelativeTime } from "../../../lib/timing";
import { recordModelUse, recordProviderUse } from "../../../lib/modelRecency";
import { nativeLocalLlmScan, nativeProviderCatalogRefresh } from "../../../lib/native-chat";
import type {
  NativeModel,
  NativeProvider,
  NativeProviderCatalog,
  NativeSetupRequired,
  VoiceBilling,
} from "../../../lib/native-chat";
import type { LogLevel } from "../../../state/log";
import {
  CONNECTED_VIA_LABELS,
  LOCAL_PROVIDER_ID,
  modelDetection,
  providerAuthOptionsLabel,
  voiceBillingMismatch,
  VOICE_BILLING_LABELS,
  VOICE_BILLING_TITLES,
  VOICE_LEVEL_LABELS,
  VOICE_LEVEL_TITLES,
} from "./chatFormat";
import { t } from "../../../i18n";

type CatalogStatus = "loading" | "refreshing" | "ready" | "stale" | "error";

/** Voice-capability narrowing for the model pane. */
type VoiceFilter = "all" | "voice" | "realtime";

const VOICE_FILTER_OPTIONS = (): OptionListOption<VoiceFilter>[] => [
  { id: "all", label: t("providerCatalogModal.all"), title: t("providerCatalogModal.showEveryModelThisProviderOffers") },
  {
    id: "voice",
    label: t("providerCatalogModal.voiceCapable"),
    title: t("providerCatalogModal.showOnlyModelsWithAVoice"),
  },
  {
    id: "realtime",
    label: t("providerCatalogModal.realtimeOnly"),
    title: t("providerCatalogModal.showOnlyFullDuplexSpeechTo"),
  },
];

/** Billing routes are styled apart from capability badges: an API-metered
 *  voice route is a cost the subscription does not cover. */
const VOICE_BILLING_CLASS: Record<VoiceBilling, string> = {
  api_key: "is-billing-api",
  subscription: "is-billing-subscription",
  local: "is-billing-local",
};

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
  // Voice narrowing is pane-local: it survives provider switches on purpose,
  // so "pick another provider" from the empty state answers the question the
  // user actually asked.
  const [voiceFilter, setVoiceFilter] = useState<VoiceFilter>("all");
  const visibleModels = useMemo(() => {
    if (voiceFilter === "all") return filteredModels;
    if (voiceFilter === "realtime") return filteredModels.filter((model) => model.voice?.level === "realtime");
    return filteredModels.filter((model) => model.voice != null && model.voice.level !== "none");
  }, [filteredModels, voiceFilter]);
  const catalogInFlight = catalogStatus === "loading" || catalogStatus === "refreshing";

  return (
              <ModalPortal>
              <div
                className="modal-overlay provider-catalog-overlay"
                role="dialog"
                aria-label={t("providerCatalogModal.providerAndModelCatalog")}
                onClick={() => {
                  addLog("debug", "Provider catalog modal closed", "overlay");
                  setShowProviderPicker(false);
                  setShowModelPicker(false);
                }}
              >
                <div className="modal provider-catalog-modal" onClick={(event) => event.stopPropagation()}>
                  <div className="modal-header">
                    <div className="provider-catalog-title">
                      <h2>{t("providerCatalogModal.providerModel")}</h2>
                      <span>
                        {catalogStatus === "loading" || catalogStatus === "refreshing"
                          ? t((catalog ? "providerCatalogModal.providerCatalog.refreshing" : "providerCatalogModal.providerCatalog.loading"))
                          : catalogStatus === "error"
                            ? t("providerCatalogModal.catalogUnavailable")
                            : catalogStatus === "stale"
                              ? t("providerCatalogModal.refreshFailedShowingCachedModels", { modelsCount: catalog?.models.length ?? 0 })
                              : t("providerCatalogModal.connectedProvidersModels", { connectedProvidersCount: connectedProviders.length, providersCount: catalog?.providers.length ?? 0, modelsCount: catalog?.models.length ?? 0 })}
                      </span>
                    </div>
                    <button
                      className="btn btn-sm provider-catalog-rescan-btn"
                      type="button"
                      title={t("providerCatalogModal.rescanForLocalLlmServers")}
                      onClick={async () => {
                        addLog("debug", "Local LLM rescan started");
                        try {
                          const servers = await nativeLocalLlmScan();
                          const reachable = servers.filter((s) => s.reachable).length;
                          addLog("info", "Local LLM rescan complete", `${reachable} reachable of ${servers.length} known`);
                          await refreshCatalog();
                        } catch (err) {
                          addLog("error", "Local LLM rescan failed", err instanceof Error ? err.message : String(err));
                        }
                      }}
                    >
                      <RefreshCw size={11} /> {t("providerCatalogModal.rescanLocal")}
                    </button>
                    <button
                      className="btn-icon"
                      type="button"
                      title={t("providerCatalogModal.closeProviderAndModelCatalog")}
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
                    <section className="provider-catalog-providers" aria-label={t("providerCatalogModal.providers")}>
                      <div className="provider-catalog-section-heading">
                        <span>{t("providerCatalogModal.providers")}</span>
                        <span className="text-muted">{t("providerCatalogModal.selectOneToBrowseIts")}</span>
                      </div>
                      <div className="provider-search-wrap">
                        <Search size={12} className="provider-search-icon" />
                        <input
                          className="input provider-search-input"
                          type="search"
                          placeholder={t("providerCatalogModal.searchProvidersAndModels")}
                          value={providerFilter}
                          onChange={(event) => setProviderFilter(event.target.value)}
                          title={t("providerCatalogModal.searchProvidersAndModels2")}
                        />
                      </div>
                      <div className="provider-card-grid">
                        {visibleCatalogProviders.map((provider) => {
                          const isLocal = provider.id === LOCAL_PROVIDER_ID;
                          // Detected local LLM server (LM Studio/Ollama/…), not the "None" sentinel.
                          const isDetectedLocal = provider.id.startsWith("local-") && !isLocal;
                          const healthBad = provider.accountCount > 0 && provider.aggregateHealth !== "healthy";
                          const needsBaseUrl = provider.status === "transport_unavailable";
                          // Auth badge: account count first, then auth method.
                          const authBadge = isLocal
                            ? null
                            : provider.accountCount > 0
                              ? `${provider.accountCount} ${provider.accountCount === 1 ? "account" : "accounts"}`
                              : provider.authMethod === "oauth"
                                ? provider.apiKeyUrl ? t("providerCatalogModal.oauthApiKey") : t("providerCatalogModal.oauth")
                                : t("providerCatalogModal.apiKey");
                          return (
                          <div
                            key={provider.id}
                            className={`provider-card is-${provider.configured ? "connected" : "available"}${provider.id === providerId ? " is-active" : ""}${isLocal ? " is-local" : ""}`}
                            title={t((provider.configured ? "providerCatalogModal.models4.connected" : "providerCatalogModal.models4.notConnected"), { label: provider.label, modelCount: provider.modelCount })}
                          >
                            <button
                              className="provider-card-select"
                              type="button"
                              title={t((provider.configured ? "providerCatalogModal.modelsClickToBrowseModels.connected" : "providerCatalogModal.modelsClickToBrowseModels.notConnected"), { label: provider.label, modelCount: provider.modelCount })}
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
                                  {t("providerCatalogModal.models", { modelCount: provider.modelCount, value: provider.connectedVia ? ` · ${CONNECTED_VIA_LABELS[provider.connectedVia]}` : "" })}</span>
                                {needsBaseUrl ? (
                                  <span className="provider-card-flag is-warn" title={t("providerCatalogModal.thisProviderUsesABespoke")}>
                                    <AlertTriangle size={10} /> {t("providerCatalogModal.needsBaseUrl")}
                                  </span>
                                ) : null}
                                {healthBad ? (
                                  <span
                                    className={`provider-card-flag is-${provider.aggregateHealth === "broken" ? "danger" : "warn"}`}
                                    title={t("providerCatalogModal.accountHealthOpenManageForPer", { aggregateHealth: provider.aggregateHealth })}
                                  >
                                    <AlertTriangle size={10} /> {provider.aggregateHealth === "broken" ? t("providerCatalogModal.needsAttention") : t("providerCatalogModal.degraded")}
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
                                <span className="provider-card-local-tag" title={t("providerCatalogModal.noProviderConnectedSelectA")}>{t("providerCatalogModal.local")}</span>
                              ) : isDetectedLocal ? (
                                <span
                                  className={`provider-card-local-tag is-${provider.configured ? "connected" : "offline"}`}
                                  title={t((provider.configured ? "providerCatalogModal.text.none" : "providerCatalogModal.text.serverOfflineShowingLast"), { detail: provider.detail })}
                                >
                                  <span className="provider-status-dot" /> {t("providerCatalogModal.local")}
                                </span>
                              ) : (
                                <button
                                  className="btn btn-sm provider-card-action-btn"
                                  type="button"
                                  title={t("providerCatalogModal.manageAccountsAndAPIKeys", { label: provider.label })}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowProviderPicker(false);
                                    setShowModelPicker(false);
                                    setLoginError(null);
                                    setManagedProviderId(provider.id);
                                    setShowLogin(true);
                                  }}
                                >
                                  <Settings2 size={11} /> {t("providerCatalogModal.manage")}
                                </button>
                              )}
                              {provider.error ? (
                                <button
                                  className="btn btn-sm provider-card-retry-btn"
                                  type="button"
                                  title={t("providerCatalogModal.retryFetchingModelsFrom", { label: provider.label })}
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
                                  {t("providerCatalogModal.retry")}
                                </button>
                              ) : null}
                            </span>
                          </div>
                          );
                        })}
                        {visibleCatalogProviders.length === 0 ? (
                          <p className="text-muted text-sm">{t("providerCatalogModal.noProvidersOrModelsMatch")}</p>
                        ) : null}
                      </div>
                    </section>
                    <section className="provider-catalog-models" aria-label={t("providerCatalogModal.models2")}>
                      <div className="provider-catalog-section-heading">
                        <span>{t("providerCatalogModal.models3", { label: selectedProvider?.label ?? providerId })}</span>
                        <span className={`provider-status is-${selectedProvider?.configured ? "connected" : "available"}`}>
                          <span className="provider-status-dot" />
                          {selectedProvider?.configured ? t("providerCatalogModal.connected") : t("providerCatalogModal.notConnected")}
                        </span>
                      </div>
                      <div className="provider-model-filters">
                        <input
                          className="input provider-model-search"
                          value={modelFilter}
                          placeholder={t("providerCatalogModal.searchThisProviderSModels")}
                          title={t("providerCatalogModal.filterModelsForTheSelected")}
                          onChange={(event) => setModelFilter(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              setShowProviderPicker(false);
                              setShowModelPicker(false);
                            }
                          }}
                        />
                        <OptionList<VoiceFilter>
                          value={voiceFilter}
                          options={VOICE_FILTER_OPTIONS()}
                          label={t("providerCatalogModal.filterModelsByVoiceCapability")}
                          compact
                          onChange={(id) => {
                            addLog("debug", "Model voice filter changed", `provider=${providerId}; filter=${id}`);
                            setVoiceFilter(id);
                          }}
                        />
                      </div>
                      <div className="provider-model-list">
                        {visibleModels.map((model) => {
                          const detection = modelDetection(model);
                          const voice = model.voice ?? null;
                          // `none` is catalogued explicitly for models that were
                          // audited and have no audio path; it earns no badge.
                          const voiceLevel = voice && voice.level !== "none" ? voice.level : null;
                          const billing = voice?.billing ?? null;
                          const mismatch = voiceBillingMismatch(model, selectedProvider);
                          return (
                          <Fragment key={`${model.providerId}:${model.id}`}>
                          <button
                            className={`provider-model-row${model.id === modelId && model.providerId === providerId ? " is-active" : ""}`}
                            type="button"
                            title={t("providerCatalogModal.text2", { label: selectedProvider?.label ?? model.providerId, id: model.id, tooltip: detection.tooltip })}
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
                                <span className="provider-model-recency" title={t("providerCatalogModal.lastUsed")}>
                                  {t("providerCatalogModal.used", { value: formatRelativeTime(modelRecency[`${model.providerId}/${model.id}`]!) })}</span>
                              ) : null}
                              {model.running ? (
                                <span className="provider-capability is-running" title={t("providerCatalogModal.loadedInMemoryOnThe")}>
                                  <span className="provider-status-dot" /> {t("providerCatalogModal.running")}
                                </span>
                              ) : null}
                              {detection.live ? (
                                <span className="provider-capability is-positive" title={detection.tooltip}>
                                  <Check size={11} aria-hidden="true" /> {t("providerCatalogModal.detected")}
                                </span>
                              ) : null}
                              {voiceLevel ? (
                                <span
                                  className={`provider-capability is-voice${voiceLevel === "realtime" ? " is-voice-realtime" : ""}`}
                                  title={VOICE_LEVEL_TITLES[voiceLevel]}
                                >
                                  {VOICE_LEVEL_LABELS[voiceLevel]}
                                </span>
                              ) : null}
                              {voiceLevel && billing ? (
                                <span
                                  className={`provider-capability ${VOICE_BILLING_CLASS[billing]}`}
                                  title={VOICE_BILLING_TITLES[billing]}
                                >
                                  {VOICE_BILLING_LABELS[billing]}
                                </span>
                              ) : null}
                              {model.supportsTools ? <span className="provider-capability is-positive">{t("providerCatalogModal.tools")}</span> : null}
                              {model.supportsReasoning ? <span className="provider-capability">{t("providerCatalogModal.reasoning")}</span> : null}
                              <span className="provider-capability">{model.supportedEfforts.length ? model.supportedEfforts.join("/") : t("providerCatalogModal.standard")}</span>
                            </span>
                          </button>
                          {mismatch ? (
                            <p className="provider-model-note" title={VOICE_BILLING_TITLES.api_key}>
                              <AlertTriangle size={11} aria-hidden="true" />
                              {mismatch}
                            </p>
                          ) : null}
                          </Fragment>
                          );
                        })}
                        {visibleModels.length === 0 ? (
                          catalogInFlight ? (
                            <SkeletonRows rows={4} label={t("providerCatalogModal.loadingModels")} />
                          ) : voiceFilter !== "all" ? (
                            <div className="provider-model-empty-state">
                              <p className="text-muted text-sm">
                                {t((voiceFilter === "realtime" ? "providerCatalogModal.noModelsUnderWidenTheFilter.realtimeVoice" : "providerCatalogModal.noModelsUnderWidenTheFilter.voiceCapable"), { label: selectedProvider?.label ?? providerId })}
                              </p>
                              <button
                                className="btn btn-sm"
                                type="button"
                                title={t("providerCatalogModal.clearTheVoiceFilterAnd")}
                                onClick={() => {
                                  addLog("debug", "Model voice filter changed", `provider=${providerId}; filter=all; via=empty-state`);
                                  setVoiceFilter("all");
                                }}
                              >
                                {t("providerCatalogModal.showAllModels")}
                              </button>
                            </div>
                          ) : selectedProvider?.id === "local-models" ? (
                            <p className="text-muted text-sm provider-model-empty">
                              {t("providerCatalogModal.noLocalModelsDetectedStart")}
                            </p>
                          ) : (
                            <p className="text-muted text-sm provider-model-empty">{t("providerCatalogModal.noMatchingModels")}</p>
                          )
                        ) : null}
                      </div>
                    </section>
                  </div>
                  ) : catalogStatus === "error" ? (
                    <div className="modal-loading" role="alert">
                      <AlertCircle size={20} />
                      <span>{t("providerCatalogModal.providerCatalogCouldNotLoad")}</span>
                      <span className="text-muted text-sm">{catalogError ?? t("providerCatalogModal.unknownCatalogError")}</span>
                      <button
                        className="btn btn-sm btn-primary"
                        type="button"
                        title={t("providerCatalogModal.retryLoadingTheProviderCatalog")}
                        onClick={() => void refreshCatalog()}
                      >
                        <RefreshCw size={12} /> {t("providerCatalogModal.retry")}
                      </button>
                    </div>
                  ) : (
                    <div className="modal-loading" role="status" aria-live="polite">
                      <Loader2 size={20} className="spin" />
                      <span>{t("providerCatalogModal.loadingProviderCatalog")}</span>
                    </div>
                  )}
                </div>
              </div>
              </ModalPortal>
  );
}
