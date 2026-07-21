import { type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { AlertTriangle, ArrowLeft, Globe, Key, Loader2, LogOut, RefreshCw, X } from "lucide-react";
import { ModalPortal } from "../../ModalPortal";
import { OptionList } from "../../layout/OptionList";
import type {
  NativeProvider,
  NativeProviderCatalog,
  NativeProviderLoginState,
  ProviderAccount,
  ProviderAccountUsage,
} from "../../../lib/native-chat";
import {
  ACCOUNT_AUTH_LABELS,
  ACCOUNT_HEALTH_LABELS,
  accountConnectedLabel,
  accountRelativeTime,
  cooldownSecondsLeft,
  formatRequestRate,
  formatTokenRate,
  formatTokens,
  type ManageTab,
} from "./chatFormat";

type UsageTotals = { requests: number; input: number; output: number; cost: number };

type ProviderManageModalProps = {
  managedProvider: NativeProvider;
  catalog: NativeProviderCatalog | null;
  needsEndpointUrl: boolean;
  manageTab: ManageTab;
  accountRows: ProviderAccount[];
  accountRowsLoading: boolean;
  testingAccountId: string | null;
  savingCred: boolean;
  providerLoginState: NativeProviderLoginState | null;
  providerLoginInput: string;
  accountUsageWindow: number;
  accountUsageLoading: boolean;
  accountUsage: ProviderAccountUsage[];
  usageTotals: UsageTotals;
  loginError: string | null;
  showApiKeyModal: boolean;
  apiKey: string;
  baseUrl: string;
  closeLoginModal: (backToCatalog?: boolean) => void;
  setManageTab: Dispatch<SetStateAction<ManageTab>>;
  openApiKeyModal: () => void;
  handleAccountTest: (account: ProviderAccount) => void;
  setConfirmLogoutProvider: Dispatch<SetStateAction<{ id: string; label: string } | null>>;
  handleProviderLogin: () => void;
  cancelProviderLogin: () => void;
  setProviderLoginInput: Dispatch<SetStateAction<string>>;
  submitProviderLoginInput: () => void;
  openApiKeyUrl: (url: string) => void;
  refreshFromOmp: () => void;
  setManagedProviderId: Dispatch<SetStateAction<string | null>>;
  setAccountUsageWindow: Dispatch<SetStateAction<number>>;
  setShowApiKeyModal: Dispatch<SetStateAction<boolean>>;
  setApiKey: Dispatch<SetStateAction<string>>;
  setBaseUrl: Dispatch<SetStateAction<string>>;
  handleSaveCredential: () => void;
};

export function ProviderManageModal({
  managedProvider,
  catalog,
  needsEndpointUrl,
  manageTab,
  accountRows,
  accountRowsLoading,
  testingAccountId,
  savingCred,
  providerLoginState,
  providerLoginInput,
  accountUsageWindow,
  accountUsageLoading,
  accountUsage,
  usageTotals,
  loginError,
  showApiKeyModal,
  apiKey,
  baseUrl,
  closeLoginModal,
  setManageTab,
  openApiKeyModal,
  handleAccountTest,
  setConfirmLogoutProvider,
  handleProviderLogin,
  cancelProviderLogin,
  setProviderLoginInput,
  submitProviderLoginInput,
  openApiKeyUrl,
  refreshFromOmp,
  setManagedProviderId,
  setAccountUsageWindow,
  setShowApiKeyModal,
  setApiKey,
  setBaseUrl,
  handleSaveCredential,
}: ProviderManageModalProps) {
  return (
        <ModalPortal>
        <div className="modal-overlay" onClick={() => closeLoginModal()} title="Close manage dialog">
          <div className="modal" onClick={(e) => e.stopPropagation()} title={`Manage ${managedProvider.label}`}>
            <div className="modal-header">
              <div className="row gap-sm">
                <button
                  className="btn-icon"
                  title="Back to the provider & model catalog"
                  type="button"
                  onClick={() => closeLoginModal(true)}
                >
                  <ArrowLeft size={16} />
                </button>
                <h2>Manage {managedProvider.label}</h2>
              </div>
              <button
                className="btn-icon"
                title="Close"
                type="button"
                onClick={() => closeLoginModal()}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-tabs" role="tablist" aria-label={`Manage ${managedProvider.label} sections`}>
              <button
                type="button"
                role="tab"
                aria-selected={manageTab === "accounts"}
                className={`modal-tab${manageTab === "accounts" ? " is-active" : ""}`}
                title={`Connected ${managedProvider.label} accounts`}
                onClick={() => setManageTab("accounts")}
              >
                Accounts{accountRows.length > 0 ? ` (${accountRows.length})` : ""}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={manageTab === "connect"}
                className={`modal-tab${manageTab === "connect" ? " is-active" : ""}`}
                title={`Add a ${managedProvider.label} account`}
                onClick={() => setManageTab("connect")}
              >
                Connect
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={manageTab === "usage"}
                className={`modal-tab${manageTab === "usage" ? " is-active" : ""}`}
                title={`Per-account ${managedProvider.label} usage`}
                onClick={() => setManageTab("usage")}
              >
                Usage
              </button>
            </div>
            <div className="modal-body stack" onClick={(e) => e.stopPropagation()}>
              {needsEndpointUrl ? (
                <div className="provider-callout is-warn" role="note" title={`${managedProvider.label} needs an endpoint URL`}>
                  <AlertTriangle size={12} className="provider-callout-icon" />
                  <div className="provider-callout-body">
                    <span className="provider-callout-title">Endpoint URL required</span>
                    <span className="text-sm text-muted">
                      {managedProvider.label} uses a bespoke API. Add an API key together with its endpoint URL to enable native chat.
                    </span>
                  </div>
                  <button
                    className="btn btn-sm"
                    type="button"
                    title="Add an API key with an endpoint URL"
                    onClick={() => {
                      setManageTab("connect");
                      openApiKeyModal();
                    }}
                  >
                    Set endpoint URL
                  </button>
                </div>
              ) : null}

              {manageTab === "accounts" ? (
                <div className="stack-sm" role="tabpanel" aria-label="Connected accounts">
                  <span className="text-sm">
                    Connected accounts
                    {accountRows.length > 0 ? ` (${accountRows.length})` : ""}
                  </span>
                  {accountRowsLoading ? (
                    <p className="text-muted text-sm">Loading accounts…</p>
                  ) : accountRows.length === 0 ? (
                    <div className="provider-empty-state">
                      <p className="text-muted text-sm">
                        No account connected yet. Connect an account to start using {managedProvider.label}.
                      </p>
                      <button
                        className="btn btn-primary"
                        type="button"
                        title={`Connect a ${managedProvider.label} account`}
                        onClick={() => setManageTab("connect")}
                      >
                        <Key size={12} /> Connect an account
                      </button>
                    </div>
                  ) : (
                    <div className="provider-account-list">
                      {accountRows.map((account) => {
                        const cdLeft = cooldownSecondsLeft(account.cooldownUntil);
                        const healthClass =
                          account.health === "healthy" ? "is-healthy"
                            : account.health === "rate_limited" ? "is-warn"
                            : "is-danger";
                        const healthText = ACCOUNT_HEALTH_LABELS[account.health] ?? account.health;
                        const lastUsed = accountRelativeTime(account.lastUsedAt);
                        const connected = accountConnectedLabel(account.createdAt);
                        const authLabel = ACCOUNT_AUTH_LABELS[account.authMethod] ?? account.authMethod;
                        const testing = testingAccountId === account.id;
                        return (
                          <div key={account.id} className="provider-account-row">
                            <div className="provider-account-info">
                              <span className={`provider-account-health ${healthClass}`} title={account.lastError ?? healthText}>
                                <span className="provider-account-health-dot" />
                                {account.label}
                              </span>
                              <span className="provider-account-meta text-muted text-sm">
                                {authLabel}
                                {connected ? ` · connected ${connected}` : ""}
                                {cdLeft != null ? ` · cooldown ${cdLeft}s` : ""}
                                {lastUsed ? ` · used ${lastUsed}` : ""}
                              </span>
                              {account.lastError && account.health !== "healthy" ? (
                                <span className="provider-account-error text-danger text-sm" title={account.lastError}>
                                  {account.lastError}
                                </span>
                              ) : null}
                            </div>
                            <div className="provider-account-actions">
                              <button
                                className="btn btn-sm"
                                type="button"
                                title={`Run a minimal authenticated request to check ${account.label}`}
                                disabled={testing}
                                onClick={() => void handleAccountTest(account)}
                              >
                                {testing ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />} Test
                              </button>
                              <button
                                className="btn btn-sm"
                                type="button"
                                title={`Log out of ${account.label} and remove its stored credential`}
                                onClick={() => setConfirmLogoutProvider({ id: account.id, label: account.label })}
                              >
                                <LogOut size={11} /> Log out
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {accountRows.length > 1 ? (
                        <button
                          className="chat-link-btn"
                          type="button"
                          title={`Log out of every ${managedProvider.label} account and block Oh My Pi re-import`}
                          onClick={() => setConfirmLogoutProvider({ id: managedProvider.id, label: managedProvider.label })}
                        >
                          Log out all accounts
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}

              {manageTab === "connect" ? (
                <div className="stack" role="tabpanel" aria-label="Connect an account">
                  {managedProvider.authMethod === "oauth" ? (
                    <div className="provider-login-cta stack-sm">
                      <p className="provider-login-cta-title">Subscription sign-in</p>
                      <p className="provider-login-cta-desc">
                        {managedProvider.id === "openai-codex"
                          ? "Sign in with your ChatGPT subscription. Basebuild opens your browser and completes the OAuth flow natively."
                          : "Sign in with your provider subscription through Oh My Pi."}
                      </p>
                      <div className="row gap-sm">
                        <button
                          className="btn btn-primary btn-lg"
                          type="button"
                          title={`Log in to ${managedProvider.label}`}
                          disabled={savingCred}
                          onClick={() => void handleProviderLogin()}
                        >
                          {savingCred ? <Loader2 size={14} className="spin" /> : <Key size={14} />}
                          {savingCred ? "Waiting for sign-in..." : `Log in to ${managedProvider.label}`}
                        </button>
                        {savingCred ? (
                          <button
                            className="btn"
                            type="button"
                            title="Cancel this sign-in attempt"
                            onClick={() => void cancelProviderLogin()}
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                      {providerLoginState ? (
                        <p className="text-sm text-muted">{providerLoginState.message}</p>
                      ) : null}
                      {providerLoginState?.status === "waiting_input" ? (
                        <div className="stack-sm">
                          <input
                            className="input"
                            type="text"
                            placeholder="Authorization code or callback URL"
                            value={providerLoginInput}
                            onChange={(event) => setProviderLoginInput(event.target.value)}
                            title={providerLoginState.prompt ?? "Provider authorization response"}
                          />
                          <button
                            className="btn btn-primary"
                            type="button"
                            title={`Submit the ${managedProvider.label} authorization response`}
                            disabled={!providerLoginInput.trim() || savingCred}
                            onClick={() => void submitProviderLoginInput()}
                          >
                            Continue sign-in
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="provider-login-cta stack-sm">
                      <p className="provider-login-cta-title">API key</p>
                      <p className="provider-login-cta-desc">
                        Connect Basebuild directly to the provider API. The key stays in Basebuild&apos;s local credential store.
                      </p>
                      <div className="row gap-sm">
                        <button
                          className="btn btn-primary btn-lg"
                          type="button"
                          title={`Add a ${managedProvider.label} API key`}
                          disabled={savingCred}
                          onClick={() => openApiKeyModal()}
                        >
                          <Key size={14} /> Add API key
                        </button>
                        {managedProvider.apiKeyUrl ? (
                          <button
                            className="chat-link-btn"
                            type="button"
                            title={`Open ${managedProvider.label} key page`}
                            onClick={() => void openApiKeyUrl(managedProvider.apiKeyUrl!)}
                          >
                            Get API key
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )}
                  {managedProvider.authMethod === "oauth" && managedProvider.apiKeyUrl ? (
                    <div className="provider-connect-section stack-sm">
                      <span className="provider-connect-heading">API key</span>
                      <p className="text-sm text-muted">
                        Prefer usage-billed access? Connect with a {managedProvider.label} API key instead.
                      </p>
                      <div className="row gap-sm">
                        <button
                          className="btn"
                          type="button"
                          title={`Add a ${managedProvider.label} API key`}
                          disabled={savingCred}
                          onClick={() => openApiKeyModal()}
                        >
                          <Key size={12} /> Add API key
                        </button>
                        <button
                          className="chat-link-btn"
                          type="button"
                          title={`Open ${managedProvider.label} key page`}
                          onClick={() => void openApiKeyUrl(managedProvider.apiKeyUrl!)}
                        >
                          Get API key
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {managedProvider.id === "openai" && catalog?.providers.some((p) => p.id === "openai-codex") ? (
                    <button
                      className="chat-link-btn"
                      type="button"
                      title="Switch to OpenAI Codex and sign in with your ChatGPT subscription"
                      onClick={() => {
                        setManagedProviderId("openai-codex");
                      }}
                    >
                      <Globe size={12} /> Have a ChatGPT subscription? Log in with OpenAI Codex
                    </button>
                  ) : null}
                  <div className="provider-connect-section stack-sm">
                    <span className="provider-connect-heading">Import from Oh My Pi</span>
                    <p className="text-sm text-muted">
                      Run <code>/login</code> in an Oh My Pi terminal, complete the provider flow, then refresh here.
                    </p>
                    <button
                      className="btn"
                      type="button"
                      title={`Import ${managedProvider.label} credentials from Oh My Pi`}
                      disabled={savingCred}
                      onClick={() => void refreshFromOmp()}
                    >
                      <RefreshCw size={12} /> {savingCred ? "Refreshing..." : "Refresh after OMP /login"}
                    </button>
                  </div>
                </div>
              ) : null}

              {manageTab === "usage" ? (
                <div className="stack-sm provider-usage-section" role="tabpanel" aria-label="Usage">
                  <div className="row row-between">
                    <span className="text-sm">Usage</span>
                    <div className="provider-usage-window">
                      <OptionList
                        value={String(accountUsageWindow)}
                        label="Usage window"
                        compact
                        onChange={(next) => setAccountUsageWindow(Number(next))}
                        options={[
                          { id: "86400", label: "Today", title: "Usage over the last 24 hours" },
                          { id: "604800", label: "7 days", title: "Usage over the last 7 days" },
                          { id: "2592000", label: "30 days", title: "Usage over the last 30 days" },
                        ]}
                      />
                    </div>
                  </div>
                  {accountUsageLoading ? (
                    <p className="text-muted text-sm">Loading usage…</p>
                  ) : accountUsage.length === 0 ? (
                    <p className="text-muted text-sm">No usage in this window.</p>
                  ) : (
                    <>
                      <div className="provider-usage-summary" title="Totals across all accounts over the selected window">
                        <span className="provider-usage-summary-num">{usageTotals.requests} reqs</span>
                        <span>{formatTokens(usageTotals.input)} in · {formatTokens(usageTotals.output)} out</span>
                        {formatRequestRate(usageTotals.requests, accountUsageWindow) ? (
                          <span className="provider-usage-rate">{formatRequestRate(usageTotals.requests, accountUsageWindow)}</span>
                        ) : null}
                        {formatTokenRate(usageTotals.input + usageTotals.output, accountUsageWindow) ? (
                          <span className="provider-usage-rate">{formatTokenRate(usageTotals.input + usageTotals.output, accountUsageWindow)}</span>
                        ) : null}
                        {usageTotals.cost > 0 ? <span>${usageTotals.cost.toFixed(2)}</span> : null}
                      </div>
                      <div className="provider-usage-list">
                        {accountUsage.map((row) => {
                          const acct = accountRows.find((a) => a.id === row.accountId);
                          const label = row.accountId == null
                            ? "Unattributed (pre-upgrade)"
                            : (acct?.label ?? row.accountId);
                          const sharePct = Math.round((row.requestShare ?? 0) * 100);
                          const reqRate = formatRequestRate(row.requests, accountUsageWindow);
                          const tokRate = formatTokenRate(row.inputTokens + row.outputTokens, accountUsageWindow);
                          return (
                            <div key={row.accountId ?? "__null"} className="provider-usage-row">
                              <div className="provider-usage-row-head">
                                <span className="text-sm">{label}</span>
                                <span className="text-muted text-sm">{row.requests} reqs</span>
                              </div>
                              <div className="provider-usage-row-stats text-muted text-sm">
                                <span>{formatTokens(row.inputTokens)} in · {formatTokens(row.outputTokens)} out</span>
                                {reqRate ? <span className="provider-usage-rate" title="Average request rate over the selected window">{reqRate}</span> : null}
                                {tokRate ? <span className="provider-usage-rate" title="Average token throughput over the selected window">{tokRate}</span> : null}
                                {row.costTotal > 0 ? <span>${row.costTotal.toFixed(2)}</span> : null}
                                {row.requests > 0 ? <span>{sharePct}%</span> : null}
                              </div>
                              {row.requests > 0 ? (
                                <div className="provider-usage-bar" title={`${sharePct}% of provider requests`}>
                                  <div className="provider-usage-bar-fill" style={{ "--fill": `${Math.max(sharePct, 2)}%` } as CSSProperties} />
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              {loginError ? <p className="text-danger text-sm">{loginError}</p> : null}
            </div>
          </div>

          {/* API key sub-modal: one focused entry surface instead of naked inputs. */}
          {showApiKeyModal ? (
            <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); setShowApiKeyModal(false); }} title="Close API key dialog">
              <div className="modal api-key-modal" onClick={(e) => e.stopPropagation()} title={`Connect ${managedProvider.label} with an API key`}>
                <div className="modal-header">
                  <h2>Connect {managedProvider.label} with an API key</h2>
                  <button
                    className="btn-icon"
                    title="Close API key dialog"
                    type="button"
                    onClick={() => setShowApiKeyModal(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="modal-body stack">
                  <p className="text-sm text-muted">
                    The key is saved as a connected account in Basebuild&apos;s local credential store and never leaves this machine.
                  </p>
                  {managedProvider.apiKeyUrl ? (
                    <button
                      className="chat-link-btn"
                      type="button"
                      title={`Open ${managedProvider.label} key page`}
                      onClick={() => void openApiKeyUrl(managedProvider.apiKeyUrl!)}
                    >
                      Get API key
                    </button>
                  ) : null}
                  <label className="stack-sm api-key-field">
                    <span className="text-sm">API key</span>
                    <input
                      className="input"
                      type="password"
                      placeholder="API key"
                      autoFocus
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      title={`API key for ${managedProvider.label}`}
                    />
                  </label>
                  <label className="stack-sm api-key-field">
                    <span className="text-sm">Endpoint URL{needsEndpointUrl ? " (required)" : " (optional)"}</span>
                    <input
                      className="input"
                      type="url"
                      placeholder={managedProvider.defaultBaseUrl ?? "https://api.example.com/v1"}
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      title="API base URL used for requests"
                    />
                    {needsEndpointUrl ? (
                      <span className="text-sm text-muted">
                        This provider&apos;s bespoke API needs an explicit endpoint URL before native chat can route requests.
                      </span>
                    ) : null}
                  </label>
                  {loginError ? <p className="text-danger text-sm">{loginError}</p> : null}
                  <div className="row gap-sm row-end">
                    <button
                      className="btn"
                      type="button"
                      title="Cancel and close the API key dialog"
                      onClick={() => setShowApiKeyModal(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      title="Save API key and connect"
                      disabled={!apiKey.trim() || (needsEndpointUrl && !baseUrl.trim()) || savingCred}
                      onClick={() => void handleSaveCredential()}
                    >
                      {savingCred ? "Saving..." : "Save API key"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        </ModalPortal>
  );
}
