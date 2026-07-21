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

function waitForProviderLoginPoll(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  window.setTimeout(resolve, 750);
  return promise;
}

export function ModelProvidersPanel() {
  const [catalog, setCatalog] = useState<NativeProviderCatalog | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [baseUrlDrafts, setBaseUrlDrafts] = useState<Record<string, string>>({});
  const [updateKeyId, setUpdateKeyId] = useState<string | null>(null);
  const [logoutTarget, setLogoutTarget] = useState<{ id: string; label: string } | null>(null);
  const [loginStates, setLoginStates] = useState<Record<string, NativeProviderLoginState>>({});
  const [loginDrafts, setLoginDrafts] = useState<Record<string, string>>({});
  const [strategy, setStrategy] = useState<ProviderAccountStrategy>("round_robin");
  const [strategyLoading, setStrategyLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void nativeProviderAccountStrategy(null)
      .then((s) => { if (!cancelled) setStrategy(s); })
      .catch(() => { /* leave default on error */ });
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
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : String(loadError)));
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
    setError("Provider sign-in timed out.");
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
    ? [{ label: "Results", providers: visibleProviders }]
    : [
        {
          label: "Popular",
          providers: visibleProviders.filter((provider) =>
            (POPULAR_PROVIDER_IDS as readonly string[]).includes(provider.id),
          ),
        },
        {
          label: "More providers",
          providers: visibleProviders.filter(
            (provider) => !(POPULAR_PROVIDER_IDS as readonly string[]).includes(provider.id),
          ),
        },
      ];

  return (
    <div className="stack">
      <h3>Model providers</h3>
      <p className="text-muted text-sm">
        Log in with a provider subscription when OAuth is available. API keys are reserved for providers without a supported sign-in flow.
      </p>
      <div className="stack-sm provider-strategy-picker" title="How Basebuild splits usage across multiple accounts on the same provider. Per-provider overrides can be set in the chat Manage dialog.">
        <span className="text-sm">Split usage across accounts</span>
        <OptionList<ProviderAccountStrategy>
          value={strategy}
          disabled={strategyLoading}
          label="Split usage across accounts"
          onChange={(next) => void updateStrategy(next)}
          options={[
            { id: "round_robin", label: "Round-robin", title: "Rotate requests evenly across every connected account" },
            { id: "sticky_session", label: "Sticky per chat", title: "Each chat session keeps using the same account" },
            { id: "fill_first", label: "Fill first", title: "Drain the first account before touching the next" },
          ]}
        />
      </div>
      <label className="stack-sm" htmlFor="provider-model-search">
        <span className="text-sm">Search providers and models</span>
        <span className="input-with-icon">
          <Search size={13} aria-hidden="true" />
          <input
            id="provider-model-search"
            className="input"
            type="search"
            placeholder="OpenAI, Claude, Gemini, model name..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            title="Search providers and models"
          />
        </span>
      </label>
      <button
        className="btn btn-sm"
        type="button"
        title="Re-read Oh My Pi credentials and refresh every provider"
        disabled={busyId !== null}
        onClick={() => {
          setBusyId("refresh");
          void refresh().finally(() => setBusyId(null));
        }}
      >
        <RefreshCw size={12} /> {busyId === "refresh" ? "Refreshing..." : "Refresh providers"}
      </button>
      <details className="stack-sm">
        <summary className="text-muted text-sm" title="Import credentials from Oh My Pi">
          Use Oh My Pi credentials (optional)
        </summary>
        <p className="text-muted text-sm">
          Open an Oh My Pi terminal, run <code>/login</code>, complete its provider flow, then choose Refresh providers.
        </p>
      </details>

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
                      title={`Open the ${provider.label} API key page`}
                    >
                      Get API key
                    </a>
                  ) : null}
                  <input
                    className="input"
                    type="password"
                    placeholder="API key"
                    value={keyDrafts[provider.id] ?? ""}
                    onChange={(event) =>
                      setKeyDrafts((previous) => ({
                        ...previous,
                        [provider.id]: event.target.value,
                      }))
                    }
                    title={`API key for ${provider.label}`}
                  />
                  {provider.id === "custom" ? (
                    <input
                      className="input"
                      type="url"
                      placeholder="https://api.example.com/v1"
                      value={baseUrlDrafts[provider.id] ?? ""}
                      onChange={(event) =>
                        setBaseUrlDrafts((previous) => ({
                          ...previous,
                          [provider.id]: event.target.value,
                        }))
                      }
                      title="Base URL for the custom OpenAI-compatible endpoint"
                    />
                  ) : null}
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    title={`Save the ${provider.label} API key`}
                    disabled={!(keyDrafts[provider.id] ?? "").trim() || isBusy}
                    onClick={() => void saveKey(provider.id, provider.label)}
                  >
                    <Key size={12} /> Save key
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
                        placeholder="Authorization code or callback URL"
                        value={loginDrafts[provider.id] ?? ""}
                        onChange={(event) =>
                          setLoginDrafts((previous) => ({
                            ...previous,
                            [provider.id]: event.target.value,
                          }))
                        }
                        title={loginState.prompt ?? "Paste the provider authorization response"}
                      />
                      <button
                        className="btn btn-sm"
                        type="button"
                        title={`Submit the ${provider.label} authorization response`}
                        disabled={!(loginDrafts[provider.id] ?? "").trim()}
                        onClick={() => void submitLoginInput(provider.id)}
                      >
                        Continue sign-in
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
                          {" "}connected via {provider.connectedVia === "oauth" ? "OAuth" : provider.connectedVia === "omp" ? "Oh My Pi" : "API key"}
                          {provider.accountCount > 1 ? ` · ${provider.accountCount} accounts` : ""}
                        </span>
                      ) : null}
                      {provider.configured && provider.aggregateHealth !== "healthy" ? (
                        <span
                          className={`text-sm text-${provider.aggregateHealth === "broken" ? "danger" : "muted"}`}
                          title={`Account health: ${provider.aggregateHealth}. Open the chat Manage dialog for per-account details.`}
                        >
                          {" "}<AlertTriangle size={11} className="inline-icon" />
                          {provider.aggregateHealth === "broken" ? "Needs attention" : "Degraded"}
                        </span>
                      ) : null}
                      {provider.modelCount > 0 ? (
                        <span className="text-muted text-sm">
                          {" "}{provider.modelCount} model{provider.modelCount === 1 ? "" : "s"}
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
                            title={`Log out of ${provider.label} and remove the stored credential`}
                            disabled={isBusy}
                            onClick={() => setLogoutTarget({ id: provider.id, label: provider.label })}
                          >
                            <LogOut size={12} /> Log out
                          </button>
                          {supportsOauth ? (
                            <button
                              className="btn btn-sm"
                              type="button"
                              title={`Log in to ${provider.label} again`}
                              disabled={isBusy}
                              onClick={() => void connectWithOmp(provider.id)}
                            >
                              {isBusy ? <Loader2 size={12} className="spin" /> : <Plug size={12} />}
                              {isBusy ? "Waiting for sign-in..." : "Log in again"}
                            </button>
                          ) : null}
                          {supportsOauth && isBusy ? (
                            <button
                              className="btn btn-sm"
                              type="button"
                              title={`Cancel the ${provider.label} sign-in attempt`}
                              onClick={() => void cancelLogin(provider.id)}
                            >
                              Cancel
                            </button>
                          ) : null}
                          {supportsApiKey ? (
                            <button
                              className="btn btn-sm"
                              type="button"
                              title={`Replace the locally stored API key for ${provider.label}`}
                              disabled={isBusy}
                              onClick={() => setUpdateKeyId(updateKeyId === provider.id ? null : provider.id)}
                            >
                              <Key size={12} /> Update API key
                            </button>
                          ) : null}
                        </div>
                        {oauthFeedback}
                        {updateKeyId === provider.id ? (
                          <div className="stack-sm">
                            <input
                              className="input"
                              type="password"
                              placeholder="New API key"
                              value={keyDrafts[provider.id] ?? ""}
                              onChange={(event) =>
                                setKeyDrafts((previous) => ({
                                  ...previous,
                                  [provider.id]: event.target.value,
                                }))
                              }
                              title={`Enter a new API key for ${provider.label}`}
                            />
                            <button
                              className="btn btn-sm"
                              type="button"
                              title={`Save the new ${provider.label} API key`}
                              disabled={!(keyDrafts[provider.id] ?? "").trim()}
                              onClick={() => void saveKey(provider.id, provider.label)}
                            >
                              <Key size={12} /> Save key
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
                                ? "Log in natively with your ChatGPT subscription. Basebuild opens your browser, completes the OAuth flow itself, and stores the token only in its local database, refreshing it before requests."
                                : "Log in with your provider subscription through Oh My Pi. Credentials remain owned and refreshed by Oh My Pi."}
                            </p>
                            <div className="row gap-sm">
                              <button
                                className="btn btn-primary btn-sm"
                                type="button"
                                title={
                                  provider.id === "openai-codex"
                                    ? `Log in to ${provider.label}`
                                    : `Log in to ${provider.label} through Oh My Pi`
                                }
                                disabled={isBusy}
                                onClick={() => void connectWithOmp(provider.id)}
                              >
                                {isBusy ? <Loader2 size={12} className="spin" /> : <Plug size={12} />}
                                {isBusy ? "Waiting for sign-in..." : `Log in to ${provider.label}`}
                              </button>
                              {isBusy ? (
                                <button
                                  className="btn btn-sm"
                                  type="button"
                                  title={`Cancel the ${provider.label} sign-in attempt`}
                                  onClick={() => void cancelLogin(provider.id)}
                                >
                                  Cancel
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
                              title={`Use a ${provider.label} API key instead of subscription login`}
                            >
                              Use an API key instead
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
      {visibleProviders.length === 0 ? (
        <p className="text-muted text-sm">No providers or models match your search.</p>
      ) : null}
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      <ConfirmDialog
        open={logoutTarget !== null}
        title={`Log out of ${logoutTarget?.label ?? "provider"}?`}
        message={`This removes the stored ${logoutTarget?.label ?? ""} credential from Basebuild's local credential store. Chats using this provider will stop working until you log in again.`}
        confirmLabel="Log out"
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
