import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Key, Loader2, LogOut, Plug, RefreshCw, Search } from "lucide-react";
import { OptionList } from "../OptionList";
import { ConfirmDialog } from "../ConfirmDialog";
import { POPULAR_PROVIDER_IDS } from "../../../lib/providerRanking";
import {
  nativeProviderCatalog,
  nativeProviderLoginCancel,
  nativeProviderLoginPoll,
  nativeProviderLoginStart,
  nativeProviderLoginSubmit,
  nativeProviderRefreshOmpCredentials,
  nativeProviderAccountStrategy,
  nativeProviderAccountStrategySet,
  nativeSaveProviderCredential,
  nativeDeleteProviderCredential,
  type NativeProviderCatalog,
  type NativeProviderLoginState,
  type ProviderAccountStrategy,
} from "../../../lib/native-chat";
import { LoadingBlock, SkeletonRows } from "../Loading";
import { t } from "../../../i18n";

function waitForProviderLoginPoll(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  window.setTimeout(resolve, 750);
  return promise;
}

export function ModelProvidersPanel() {
  const [catalog, setCatalog] = useState<NativeProviderCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [baseUrlDrafts, setBaseUrlDrafts] = useState<Record<string, string>>({});
  const [updateKeyId, setUpdateKeyId] = useState<string | null>(null);
  const [logoutTarget, setLogoutTarget] = useState<{ id: string; label: string } | null>(null);
  const [loginStates, setLoginStates] = useState<Record<string, NativeProviderLoginState>>({});
  const [loginDrafts, setLoginDrafts] = useState<Record<string, string>>({});
  // `null` until the mount fetch settles — rendering the picker on the
  // "round_robin" default would assert a strategy the user may not have.
  const [strategy, setStrategy] = useState<ProviderAccountStrategy | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void nativeProviderAccountStrategy(null)
      .then((s) => { if (!cancelled) setStrategy(s); })
      .catch(() => { if (!cancelled) setStrategy("round_robin"); });
    return () => { cancelled = true; };
  }, []);

  const updateStrategy = useCallback(async (next: ProviderAccountStrategy) => {
    setStrategy(next);
    setStrategyLoading(true);
    try {
      await nativeProviderAccountStrategySet(null, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStrategyLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const next = await nativeProviderRefreshOmpCredentials();
      setCatalog(next);
      return next;
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      return null;
    }
  }, []);

  useEffect(() => {
    void nativeProviderCatalog()
      .then(setCatalog)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : String(loadError)))
      .finally(() => setCatalogLoading(false));
  }, []);


  const saveKey = useCallback(
    async (providerId: string, label: string) => {
      const key = (keyDrafts[providerId] ?? "").trim();
      if (!key) return;
      setBusyId(providerId);
      setError(null);
      try {
        await nativeSaveProviderCredential({
          providerId,
          label,
          apiKey: key,
          baseUrl: (baseUrlDrafts[providerId] ?? "").trim() || null,
        });
        setKeyDrafts((previous) => ({ ...previous, [providerId]: "" }));
        setUpdateKeyId(null);
        setCatalog(await nativeProviderRefreshOmpCredentials(providerId));
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : String(saveError));
      } finally {
        setBusyId(null);
      }
    },
    [keyDrafts, baseUrlDrafts],
  );

  const disconnect = useCallback(async (providerId: string) => {
    setBusyId(providerId);
    setError(null);
    try {
      await nativeDeleteProviderCredential(providerId);
      setCatalog(await nativeProviderCatalog());
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : String(disconnectError));
    } finally {
      setBusyId(null);
    }
  }, []);

  async function pollLogin(providerId: string) {
    for (let attempt = 0; attempt < 800; attempt += 1) {
      await waitForProviderLoginPoll();
      const state = await nativeProviderLoginPoll(providerId);
      setLoginStates((previous) => ({ ...previous, [providerId]: state }));
      if (state.complete) {
        setCatalog(await nativeProviderRefreshOmpCredentials(providerId));
        setBusyId(null);
        return;
      }
      if (state.error) {
        setError(state.error);
        setBusyId(null);
        return;
      }
      if (state.status === "waiting_input" || state.status === "cancelled") {
        if (state.status === "cancelled") setBusyId(null);
        return;
      }
    }
    setError(t("modelProvidersPanel.providerSignInTimedOut"));
    setBusyId(null);
  }

  async function cancelLogin(providerId: string) {
    try {
      const state = await nativeProviderLoginCancel(providerId);
      setLoginStates((previous) => ({ ...previous, [providerId]: state }));
    } catch {
      // No active sign-in — nothing to cancel.
    }
    setBusyId(null);
  }

  async function connectWithOmp(providerId: string) {
    setBusyId(providerId);
    setError(null);
    try {
      const state = await nativeProviderLoginStart(providerId);
      setLoginStates((previous) => ({ ...previous, [providerId]: state }));
      await pollLogin(providerId);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
      setBusyId(null);
    }
  }

  async function submitLoginInput(providerId: string) {
    const value = (loginDrafts[providerId] ?? "").trim();
    if (!value) return;
    setError(null);
    try {
      const state = await nativeProviderLoginSubmit(providerId, value);
      setLoginDrafts((previous) => ({ ...previous, [providerId]: "" }));
      setLoginStates((previous) => ({ ...previous, [providerId]: state }));
      await pollLogin(providerId);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
      setBusyId(null);
    }
  }

  const visibleProviders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (catalog?.providers ?? [])
      .filter((provider) => !provider.localOnly)
      .filter((provider) => {
        if (!needle) return true;
        if (`${provider.id} ${provider.label} ${provider.detail}`.toLowerCase().includes(needle)) {
          return true;
        }
        return catalog?.models.some(
          (model) =>
            model.providerId === provider.id &&
            `${model.id} ${model.label}`.toLowerCase().includes(needle),
        );
      })
      .sort((left, right) => {
        const leftIndex = POPULAR_PROVIDER_IDS.indexOf(
          left.id as (typeof POPULAR_PROVIDER_IDS)[number],
        );
        const rightIndex = POPULAR_PROVIDER_IDS.indexOf(
          right.id as (typeof POPULAR_PROVIDER_IDS)[number],
        );
        const leftPriority = leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex;
        const rightPriority = rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex;
        return (
          leftPriority - rightPriority ||
          Number(right.configured) - Number(left.configured) ||
          left.label.localeCompare(right.label)
        );
      });
  }, [catalog, query]);

  const groups = query.trim()
    ? [{ label: t("modelProvidersPanel.results"), providers: visibleProviders }]
    : [
        {
          label: t("modelProvidersPanel.popular"),
          providers: visibleProviders.filter((provider) =>
            (POPULAR_PROVIDER_IDS as readonly string[]).includes(provider.id),
          ),
        },
        {
          label: t("modelProvidersPanel.moreProviders"),
          providers: visibleProviders.filter(
            (provider) => !(POPULAR_PROVIDER_IDS as readonly string[]).includes(provider.id),
          ),
        },
      ];

  return (
    <div className="stack">
      <h3>{t("modelProvidersPanel.modelProviders")}</h3>
      <p className="text-muted text-sm">
        {t("modelProvidersPanel.logInWithAProvider")}
      </p>
      <div className="stack-sm provider-strategy-picker" title={t("modelProvidersPanel.howBasebuildSplitsUsageAcross")}>
        <span className="text-sm">{t("modelProvidersPanel.splitUsageAcrossAccounts")}</span>
        {strategy === null ? (
          <LoadingBlock label={t("modelProvidersPanel.loadingAccountStrategy")} compact />
        ) : (
          <OptionList<ProviderAccountStrategy>
            value={strategy}
            disabled={strategyLoading}
            label={t("modelProvidersPanel.splitUsageAcrossAccounts")}
            onChange={(next) => void updateStrategy(next)}
            options={[
              { id: "round_robin", label: t("modelProvidersPanel.roundRobin"), title: t("modelProvidersPanel.rotateRequestsEvenlyAcrossEveryConnected") },
              { id: "sticky_session", label: t("modelProvidersPanel.stickyPerChat"), title: t("modelProvidersPanel.eachChatSessionKeepsUsingThe") },
              { id: "fill_first", label: t("modelProvidersPanel.fillFirst"), title: t("modelProvidersPanel.drainTheFirstAccountBeforeTouching") },
            ]}
          />
        )}
      </div>
      <label className="stack-sm" htmlFor="provider-model-search">
        <span className="text-sm">{t("modelProvidersPanel.searchProvidersAndModels")}</span>
        <span className="input-with-icon">
          <Search size={13} aria-hidden="true" />
          <input
            id="provider-model-search"
            className="input"
            type="search"
            placeholder={t("modelProvidersPanel.openAIClaudeGeminiModelName")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            title={t("modelProvidersPanel.searchProvidersAndModels")}
          />
        </span>
      </label>
      <button
        className="btn btn-sm"
        type="button"
        title={t("modelProvidersPanel.reReadOhMyPi")}
        disabled={busyId !== null}
        onClick={() => {
          setBusyId("refresh");
          void refresh().finally(() => setBusyId(null));
        }}
      >
        <RefreshCw size={12} /> {busyId === "refresh" ? t("modelProvidersPanel.refreshing") : t("modelProvidersPanel.refreshProviders")}
      </button>
      <details className="stack-sm">
        <summary className="text-muted text-sm" title={t("modelProvidersPanel.importCredentialsFromOhMy")}>
          {t("modelProvidersPanel.useOhMyPiCredentials")}
        </summary>
        <p className="text-muted text-sm">
          {t("modelProvidersPanel.openAnOhMyPi")} <code>{t("modelProvidersPanel.login")}</code>{t("modelProvidersPanel.completeItsProviderFlowThen")}
        </p>
      </details>

      {catalogLoading ? <SkeletonRows rows={5} label={t("modelProvidersPanel.loadingProviders")} /> : null}
      {groups.map((group) =>
        group.providers.length > 0 ? (
          <Fragment key={group.label}>
            <h4>{group.label}</h4>
            {group.providers.map((provider) => {
              const supportsOauth = provider.authMethod === "oauth";
              const supportsApiKey = provider.authMethod !== "oauth" || provider.apiKeyUrl !== null;
              const isBusy = busyId === provider.id;
              const loginState = loginStates[provider.id];
              const connectKeyForm = (
                <div className="stack-sm">
                  {provider.apiKeyUrl ? (
                    <a
                      href={provider.apiKeyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted text-sm"
                      title={t("modelProvidersPanel.openTheAPIKeyPage", { label: provider.label })}
                    >
                      {t("modelProvidersPanel.getApiKey")}
                    </a>
                  ) : null}
                  <input
                    className="input"
                    type="password"
                    placeholder={t("modelProvidersPanel.aPIKey")}
                    value={keyDrafts[provider.id] ?? ""}
                    onChange={(event) =>
                      setKeyDrafts((previous) => ({
                        ...previous,
                        [provider.id]: event.target.value,
                      }))
                    }
                    title={t("modelProvidersPanel.aPIKeyFor", { label: provider.label })}
                  />
                  {provider.id === "custom" ? (
                    <input
                      className="input"
                      type="url"
                      placeholder={t("modelProvidersPanel.httpsApiExampleComV1")}
                      value={baseUrlDrafts[provider.id] ?? ""}
                      onChange={(event) =>
                        setBaseUrlDrafts((previous) => ({
                          ...previous,
                          [provider.id]: event.target.value,
                        }))
                      }
                      title={t("modelProvidersPanel.baseUrlForTheCustom")}
                    />
                  ) : null}
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    title={t("modelProvidersPanel.saveTheAPIKey", { label: provider.label })}
                    disabled={!(keyDrafts[provider.id] ?? "").trim() || isBusy}
                    onClick={() => void saveKey(provider.id, provider.label)}
                  >
                    <Key size={12} /> {t("modelProvidersPanel.saveKey")}
                  </button>
                </div>
              );
              const oauthFeedback = (
                <>
                  {loginState ? (
                    <p className={loginState.error ? "text-danger text-sm" : "text-muted text-sm"}>
                      {loginState.error ?? loginState.message}
                    </p>
                  ) : null}
                  {loginState?.status === "waiting_input" ? (
                    <div className="stack-sm">
                      <input
                        className="input"
                        type="text"
                        placeholder={t("modelProvidersPanel.authorizationCodeOrCallbackUrl")}
                        value={loginDrafts[provider.id] ?? ""}
                        onChange={(event) =>
                          setLoginDrafts((previous) => ({
                            ...previous,
                            [provider.id]: event.target.value,
                          }))
                        }
                        title={loginState.prompt ?? t("modelProvidersPanel.pasteTheProviderAuthorizationResponse")}
                      />
                      <button
                        className="btn btn-sm"
                        type="button"
                        title={t("modelProvidersPanel.submitTheAuthorizationResponse", { label: provider.label })}
                        disabled={!(loginDrafts[provider.id] ?? "").trim()}
                        onClick={() => void submitLoginInput(provider.id)}
                      >
                        {t("modelProvidersPanel.continueSignIn")}
                      </button>
                    </div>
                  ) : null}
                </>
              );
              return (
                <div key={provider.id} className="requirement-row items-start">
                  <span className={`requirement-badge is-${provider.configured ? "ok" : "attention"}`}>
                    {provider.configured ? "✓" : "!"}
                  </span>
                  <div className="flex-1">
                    <div className="requirement-name">
                      {provider.label}
                      {provider.configured ? (
                        <span className="text-muted text-sm">
                          {" "}{t("modelProvidersPanel.connectedVia", { method: provider.connectedVia === "oauth" ? t("modelProvidersPanel.oAuth") : provider.connectedVia === "omp" ? t("modelProvidersPanel.ohMyPi") : t("modelProvidersPanel.aPIKey") })}
                          {provider.accountCount > 1 ? t("modelProvidersPanel.accounts", { accountCount: provider.accountCount }) : ""}
                        </span>
                      ) : null}
                      {provider.configured && provider.aggregateHealth !== "healthy" ? (
                        <span
                          className={`text-sm text-${provider.aggregateHealth === "broken" ? "danger" : "muted"}`}
                          title={t("modelProvidersPanel.accountHealthOpenTheChatManage", { aggregateHealth: provider.aggregateHealth })}
                        >
                          {" "}<AlertTriangle size={11} className="inline-icon" />
                          {provider.aggregateHealth === "broken" ? t("modelProvidersPanel.needsAttention") : t("modelProvidersPanel.degraded")}
                        </span>
                      ) : null}
                      {provider.modelCount > 0 ? (
                        <span className="text-muted text-sm">
                          {" "}{t(provider.modelCount === 1 ? "modelProvidersPanel.modelOne" : "modelProvidersPanel.modelMany", { count: provider.modelCount })}
                        </span>
                      ) : null}
                    </div>
                    {!provider.configured ? <p className="text-muted text-sm">{provider.detail}</p> : null}
                    {provider.configured ? (
                      <div className="stack-sm mt-6">
                        <div className="row gap-sm">
                          <button
                            className="btn btn-sm"
                            type="button"
                            title={t("modelProvidersPanel.logOutOfAndRemoveThe", { label: provider.label })}
                            disabled={isBusy}
                            onClick={() => setLogoutTarget({ id: provider.id, label: provider.label })}
                          >
                            <LogOut size={12} /> {t("modelProvidersPanel.logOut")}
                          </button>
                          {supportsOauth ? (
                            <button
                              className="btn btn-sm"
                              type="button"
                              title={t("modelProvidersPanel.logInToAgain", { label: provider.label })}
                              disabled={isBusy}
                              onClick={() => void connectWithOmp(provider.id)}
                            >
                              {isBusy ? <Loader2 size={12} className="spin" /> : <Plug size={12} />}
                              {isBusy ? t("modelProvidersPanel.waitingForSignIn") : t("modelProvidersPanel.logInAgain")}
                            </button>
                          ) : null}
                          {supportsOauth && isBusy ? (
                            <button
                              className="btn btn-sm"
                              type="button"
                              title={t("modelProvidersPanel.cancelTheSignInAttempt", { label: provider.label })}
                              onClick={() => void cancelLogin(provider.id)}
                            >
                              {t("modelProvidersPanel.cancel")}
                            </button>
                          ) : null}
                          {supportsApiKey ? (
                            <button
                              className="btn btn-sm"
                              type="button"
                              title={t("modelProvidersPanel.replaceTheLocallyStoredAPIKey", { label: provider.label })}
                              disabled={isBusy}
                              onClick={() => setUpdateKeyId(updateKeyId === provider.id ? null : provider.id)}
                            >
                              <Key size={12} /> {t("modelProvidersPanel.updateApiKey")}
                            </button>
                          ) : null}
                        </div>
                        {oauthFeedback}
                        {updateKeyId === provider.id ? (
                          <div className="stack-sm">
                            <input
                              className="input"
                              type="password"
                              placeholder={t("modelProvidersPanel.newApiKey")}
                              value={keyDrafts[provider.id] ?? ""}
                              onChange={(event) =>
                                setKeyDrafts((previous) => ({
                                  ...previous,
                                  [provider.id]: event.target.value,
                                }))
                              }
                              title={t("modelProvidersPanel.enterANewAPIKeyFor", { label: provider.label })}
                            />
                            <button
                              className="btn btn-sm"
                              type="button"
                              title={t("modelProvidersPanel.saveTheNewAPIKey", { label: provider.label })}
                              disabled={!(keyDrafts[provider.id] ?? "").trim()}
                              onClick={() => void saveKey(provider.id, provider.label)}
                            >
                              <Key size={12} /> {t("modelProvidersPanel.saveKey")}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="stack-sm mt-6">
                        {supportsOauth ? (
                          <div className="stack-sm">
                            <p className="text-muted text-sm">
                              {provider.id === "openai-codex"
                                ? t("modelProvidersPanel.logInNativelyWithYour")
                                : t("modelProvidersPanel.logInWithYourProvider")}
                            </p>
                            <div className="row gap-sm">
                              <button
                                className="btn btn-primary btn-sm"
                                type="button"
                                title={
                                  provider.id === "openai-codex"
                                    ? t("modelProvidersPanel.logInTo", { label: provider.label })
                                    : t("modelProvidersPanel.logInToThroughOhMy", { label: provider.label })
                                }
                                disabled={isBusy}
                                onClick={() => void connectWithOmp(provider.id)}
                              >
                                {isBusy ? <Loader2 size={12} className="spin" /> : <Plug size={12} />}
                                {isBusy ? t("modelProvidersPanel.waitingForSignIn") : t("modelProvidersPanel.logInTo2", { label: provider.label })}
                              </button>
                              {isBusy ? (
                                <button
                                  className="btn btn-sm"
                                  type="button"
                                  title={t("modelProvidersPanel.cancelTheSignInAttempt2", { label: provider.label })}
                                  onClick={() => void cancelLogin(provider.id)}
                                >
                                  {t("modelProvidersPanel.cancel")}
                                </button>
                              ) : null}
                            </div>
                            {oauthFeedback}
                          </div>
                        ) : (
                          connectKeyForm
                        )}
                        {supportsOauth && supportsApiKey ? (
                          <details className="stack-sm">
                            <summary
                              className="text-muted text-sm"
                              title={t("modelProvidersPanel.useAAPIKeyInsteadOf", { label: provider.label })}
                            >
                              {t("modelProvidersPanel.useAnApiKeyInstead")}
                            </summary>
                            {connectKeyForm}
                          </details>
                        ) : null}
                      </div>
                    )}
                    {provider.error ? <p className="text-danger text-sm">{provider.error}</p> : null}
                  </div>
                </div>
              );
            })}
          </Fragment>
        ) : null,
      )}
      {!catalogLoading && catalog !== null && visibleProviders.length === 0 ? (
        <p className="text-muted text-sm">{t("modelProvidersPanel.noProvidersOrModelsMatch")}</p>
      ) : null}
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      <ConfirmDialog
        open={logoutTarget !== null}
        title={t("modelProvidersPanel.logOutOf", { label: logoutTarget?.label ?? "provider" })}
        message={t("modelProvidersPanel.thisRemovesTheStoredCredentialFrom", { value1: logoutTarget?.label ?? "" })}
        confirmLabel={t("modelProvidersPanel.logOut2")}
        destructive
        onConfirm={() => {
          if (logoutTarget) void disconnect(logoutTarget.id);
          setLogoutTarget(null);
        }}
        onCancel={() => setLogoutTarget(null)}
      />
    </div>
  );
}
