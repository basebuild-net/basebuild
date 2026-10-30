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
import { t } from "../../../i18n";

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
        <div className="modal-overlay" onClick={() => closeLoginModal()} title={t("providerManageModal.closeManageDialog")}>
          <div className="modal" onClick={(e) => e.stopPropagation()} title={t("providerManageModal.manage2", { label: managedProvider.label })}>
            <div className="modal-header">
              <div className="row gap-sm">
                <button
                  className="btn-icon"
                  title={t("providerManageModal.backToTheProviderModel")}
                  type="button"
                  onClick={() => closeLoginModal(true)}
                >
                  <ArrowLeft size={16} />
                </button>
                <h2>{t("providerManageModal.manage", { label: managedProvider.label })}</h2>
              </div>
              <button
                className="btn-icon"
                title={t("providerManageModal.close")}
                type="button"
                onClick={() => closeLoginModal()}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-tabs" role="tablist" aria-label={t("providerManageModal.manageSections", { label: managedProvider.label })}>
              <button
                type="button"
                role="tab"
                aria-selected={manageTab === "accounts"}
                className={`modal-tab${manageTab === "accounts" ? " is-active" : ""}`}
                title={t("providerManageModal.connectedAccounts3", { label: managedProvider.label })}
                onClick={() => setManageTab("accounts")}
              >
                {t("providerManageModal.accounts", { value: accountRows.length > 0 ? ` (${accountRows.length})` : "" })}</button>
              <button
                type="button"
                role="tab"
                aria-selected={manageTab === "connect"}
                className={`modal-tab${manageTab === "connect" ? " is-active" : ""}`}
                title={t("providerManageModal.addAAccount", { label: managedProvider.label })}
                onClick={() => setManageTab("connect")}
              >
                {t("providerManageModal.connect")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={manageTab === "usage"}
                className={`modal-tab${manageTab === "usage" ? " is-active" : ""}`}
                title={t("providerManageModal.perAccountUsage", { label: managedProvider.label })}
                onClick={() => setManageTab("usage")}
              >
                {t("providerManageModal.usage")}
              </button>
            </div>
            <div className="modal-body stack" onClick={(e) => e.stopPropagation()}>
              {needsEndpointUrl ? (
                <div className="provider-callout is-warn" role="note" title={t("providerManageModal.needsAnEndpointURL", { label: managedProvider.label })}>
                  <AlertTriangle size={12} className="provider-callout-icon" />
                  <div className="provider-callout-body">
                    <span className="provider-callout-title">{t("providerManageModal.endpointUrlRequired")}</span>
                    <span className="text-sm text-muted">
                      {t("providerManageModal.usesABespokeApiAdd", { label: managedProvider.label })}
                    </span>
                  </div>
                  <button
                    className="btn btn-sm"
                    type="button"
                    title={t("providerManageModal.addAnApiKeyWith")}
                    onClick={() => {
                      setManageTab("connect");
                      openApiKeyModal();
                    }}
                  >
                    {t("providerManageModal.setEndpointUrl")}
                  </button>
                </div>
              ) : null}

              {manageTab === "accounts" ? (
                <div className="stack-sm" role="tabpanel" aria-label={t("providerManageModal.connectedAccounts")}>
                  <span className="text-sm">
                    {t("providerManageModal.connectedAccounts2", { value: accountRows.length > 0 ? ` (${accountRows.length})` : "" })}</span>
                  {accountRowsLoading ? (
                    <p className="text-muted text-sm">{t("providerManageModal.loadingAccounts")}</p>
                  ) : accountRows.length === 0 ? (
                    <div className="provider-empty-state">
                      <p className="text-muted text-sm">
                        {t("providerManageModal.noAccountConnectedYetConnect", { label: managedProvider.label })}
                      </p>
                      <button
                        className="btn btn-primary"
                        type="button"
                        title={t("providerManageModal.connectAAccount", { label: managedProvider.label })}
                        onClick={() => setManageTab("connect")}
                      >
                        <Key size={12} /> {t("providerManageModal.connectAnAccount")}
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
                                {connected ? t("providerManageModal.connected", { connected: connected }) : ""}
                                {cdLeft != null ? t("providerManageModal.cooldownS", { cdLeft: cdLeft }) : ""}
                                {lastUsed ? t("providerManageModal.used", { lastUsed: lastUsed }) : ""}
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
                                title={t("providerManageModal.runAMinimalAuthenticatedRequestTo", { label: account.label })}
                                disabled={testing}
                                onClick={() => void handleAccountTest(account)}
                              >
                                {testing ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />} {t("providerManageModal.test")}
                              </button>
                              <button
                                className="btn btn-sm"
                                type="button"
                                title={t("providerManageModal.logOutOfAndRemoveIts", { label: account.label })}
                                onClick={() => setConfirmLogoutProvider({ id: account.id, label: account.label })}
                              >
                                <LogOut size={11} /> {t("providerManageModal.logOut")}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {accountRows.length > 1 ? (
                        <button
                          className="chat-link-btn"
                          type="button"
                          title={t("providerManageModal.logOutOfEveryAccountAnd", { label: managedProvider.label })}
                          onClick={() => setConfirmLogoutProvider({ id: managedProvider.id, label: managedProvider.label })}
                        >
                          {t("providerManageModal.logOutAllAccounts")}
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}

              {manageTab === "connect" ? (
                <div className="stack" role="tabpanel" aria-label={t("providerManageModal.connectAnAccount")}>
                  {managedProvider.authMethod === "oauth" ? (
                    <div className="provider-login-cta stack-sm">
                      <p className="provider-login-cta-title">{t("providerManageModal.subscriptionSignIn")}</p>
                      <p className="provider-login-cta-desc">
                        {managedProvider.id === "openai-codex"
                          ? t("providerManageModal.signInWithYourChatgpt")
                          : t("providerManageModal.signInWithYourProvider")}
                      </p>
                      <div className="row gap-sm">
                        <button
                          className="btn btn-primary btn-lg"
                          type="button"
                          title={t("providerManageModal.logInTo", { label: managedProvider.label })}
                          disabled={savingCred}
                          onClick={() => void handleProviderLogin()}
                        >
                          {savingCred ? <Loader2 size={14} className="spin" /> : <Key size={14} />}
                          {savingCred ? t("providerManageModal.waitingForSignIn") : t("providerManageModal.logInTo2", { label: managedProvider.label })}
                        </button>
                        {savingCred ? (
                          <button
                            className="btn"
                            type="button"
                            title={t("providerManageModal.cancelThisSignInAttempt")}
                            onClick={() => void cancelProviderLogin()}
                          >
                            {t("providerManageModal.cancel")}
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
                            placeholder={t("providerManageModal.authorizationCodeOrCallbackUrl")}
                            value={providerLoginInput}
                            onChange={(event) => setProviderLoginInput(event.target.value)}
                            title={providerLoginState.prompt ?? t("providerManageModal.providerAuthorizationResponse")}
                          />
                          <button
                            className="btn btn-primary"
                            type="button"
                            title={t("providerManageModal.submitTheAuthorizationResponse", { label: managedProvider.label })}
                            disabled={!providerLoginInput.trim() || savingCred}
                            onClick={() => void submitProviderLoginInput()}
                          >
                            {t("providerManageModal.continueSignIn")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="provider-login-cta stack-sm">
                      <p className="provider-login-cta-title">{t("providerManageModal.aPIKey")}</p>
                      <p className="provider-login-cta-desc">
                        {t("providerManageModal.connectBasebuildDirectlyToThe")}
                      </p>
                      <div className="row gap-sm">
                        <button
                          className="btn btn-primary btn-lg"
                          type="button"
                          title={t("providerManageModal.addAAPIKey", { label: managedProvider.label })}
                          disabled={savingCred}
                          onClick={() => openApiKeyModal()}
                        >
                          <Key size={14} /> {t("providerManageModal.addApiKey")}
                        </button>
                        {managedProvider.apiKeyUrl ? (
                          <button
                            className="chat-link-btn"
                            type="button"
                            title={t("providerManageModal.openKeyPage", { label: managedProvider.label })}
                            onClick={() => void openApiKeyUrl(managedProvider.apiKeyUrl!)}
                          >
                            {t("providerManageModal.getApiKey")}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )}
                  {managedProvider.authMethod === "oauth" && managedProvider.apiKeyUrl ? (
                    <div className="provider-connect-section stack-sm">
                      <span className="provider-connect-heading">{t("providerManageModal.aPIKey")}</span>
                      <p className="text-sm text-muted">
                        {t("providerManageModal.preferUsageBilledAccessConnect", { label: managedProvider.label })}
                      </p>
                      <div className="row gap-sm">
                        <button
                          className="btn"
                          type="button"
                          title={t("providerManageModal.addAAPIKey2", { label: managedProvider.label })}
                          disabled={savingCred}
                          onClick={() => openApiKeyModal()}
                        >
                          <Key size={12} /> {t("providerManageModal.addApiKey")}
                        </button>
                        <button
                          className="chat-link-btn"
                          type="button"
                          title={t("providerManageModal.openKeyPage2", { label: managedProvider.label })}
                          onClick={() => void openApiKeyUrl(managedProvider.apiKeyUrl!)}
                        >
                          {t("providerManageModal.getApiKey")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {managedProvider.id === "openai" && catalog?.providers.some((p) => p.id === "openai-codex") ? (
                    <button
                      className="chat-link-btn"
                      type="button"
                      title={t("providerManageModal.switchToOpenaiCodexAnd")}
                      onClick={() => {
                        setManagedProviderId("openai-codex");
                      }}
                    >
                      <Globe size={12} /> {t("providerManageModal.haveAChatgptSubscriptionLog")}
                    </button>
                  ) : null}
                  <div className="provider-connect-section stack-sm">
                    <span className="provider-connect-heading">{t("providerManageModal.importFromOhMyPi")}</span>
                    <p className="text-sm text-muted">
                      {t("providerManageModal.run")} <code>{t("providerManageModal.login")}</code> {t("providerManageModal.inAnOhMyPi")}
                    </p>
                    <button
                      className="btn"
                      type="button"
                      title={t("providerManageModal.importCredentialsFromOhMyPi", { label: managedProvider.label })}
                      disabled={savingCred}
                      onClick={() => void refreshFromOmp()}
                    >
                      <RefreshCw size={12} /> {savingCred ? t("providerManageModal.refreshing") : t("providerManageModal.refreshAfterOmpLogin")}
                    </button>
                  </div>
                </div>
              ) : null}

              {manageTab === "usage" ? (
                <div className="stack-sm provider-usage-section" role="tabpanel" aria-label={t("providerManageModal.usage")}>
                  <div className="row row-between">
                    <span className="text-sm">{t("providerManageModal.usage")}</span>
                    <div className="provider-usage-window">
                      <OptionList
                        value={String(accountUsageWindow)}
                        label={t("providerManageModal.usageWindow")}
                        compact
                        onChange={(next) => setAccountUsageWindow(Number(next))}
                        options={[
                          { id: "86400", label: t("providerManageModal.today"), title: t("providerManageModal.usageOverTheLast24Hours") },
                          { id: "604800", label: "7 days", title: t("providerManageModal.usageOverTheLast7Days") },
                          { id: "2592000", label: "30 days", title: t("providerManageModal.usageOverTheLast30Days") },
                        ]}
                      />
                    </div>
                  </div>
                  {accountUsageLoading ? (
                    <p className="text-muted text-sm">{t("providerManageModal.loadingUsage")}</p>
                  ) : accountUsage.length === 0 ? (
                    <p className="text-muted text-sm">{t("providerManageModal.noUsageInThisWindow")}</p>
                  ) : (
                    <>
                      <div className="provider-usage-summary" title={t("providerManageModal.totalsAcrossAllAccountsOver")}>
                        <span className="provider-usage-summary-num">{t("providerManageModal.reqs", { requests: usageTotals.requests })}</span>
                        <span>{t("providerManageModal.inOut", { input: formatTokens(usageTotals.input), output: formatTokens(usageTotals.output) })}</span>
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
                            ? t("providerManageModal.unattributedPreUpgrade")
                            : (acct?.label ?? row.accountId);
                          const sharePct = Math.round((row.requestShare ?? 0) * 100);
                          const reqRate = formatRequestRate(row.requests, accountUsageWindow);
                          const tokRate = formatTokenRate(row.inputTokens + row.outputTokens, accountUsageWindow);
                          return (
                            <div key={row.accountId ?? "__null"} className="provider-usage-row">
                              <div className="provider-usage-row-head">
                                <span className="text-sm">{label}</span>
                                <span className="text-muted text-sm">{t("providerManageModal.reqs2", { requests: row.requests })}</span>
                              </div>
                              <div className="provider-usage-row-stats text-muted text-sm">
                                <span>{t("providerManageModal.inOut2", { inputTokens: formatTokens(row.inputTokens), outputTokens: formatTokens(row.outputTokens) })}</span>
                                {reqRate ? <span className="provider-usage-rate" title={t("providerManageModal.averageRequestRateOverThe")}>{reqRate}</span> : null}
                                {tokRate ? <span className="provider-usage-rate" title={t("providerManageModal.averageTokenThroughputOverThe")}>{tokRate}</span> : null}
                                {row.costTotal > 0 ? <span>${row.costTotal.toFixed(2)}</span> : null}
                                {row.requests > 0 ? <span>{sharePct}%</span> : null}
                              </div>
                              {row.requests > 0 ? (
                                <div className="provider-usage-bar" title={t("providerManageModal.ofProviderRequests", { sharePct: sharePct })}>
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
            <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); setShowApiKeyModal(false); }} title={t("providerManageModal.closeApiKeyDialog")}>
              <div className="modal api-key-modal" onClick={(e) => e.stopPropagation()} title={t("providerManageModal.connectWithAnAPIKey", { label: managedProvider.label })}>
                <div className="modal-header">
                  <h2>{t("providerManageModal.connectWithAnApiKey", { label: managedProvider.label })}</h2>
                  <button
                    className="btn-icon"
                    title={t("providerManageModal.closeApiKeyDialog")}
                    type="button"
                    onClick={() => setShowApiKeyModal(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="modal-body stack">
                  <p className="text-sm text-muted">
                    {t("providerManageModal.theKeyIsSavedAs")}
                  </p>
                  {managedProvider.apiKeyUrl ? (
                    <button
                      className="chat-link-btn"
                      type="button"
                      title={t("providerManageModal.openKeyPage3", { label: managedProvider.label })}
                      onClick={() => void openApiKeyUrl(managedProvider.apiKeyUrl!)}
                    >
                      {t("providerManageModal.getApiKey")}
                    </button>
                  ) : null}
                  <label className="stack-sm api-key-field">
                    <span className="text-sm">{t("providerManageModal.aPIKey")}</span>
                    <input
                      className="input"
                      type="password"
                      placeholder={t("providerManageModal.aPIKey")}
                      autoFocus
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      title={t("providerManageModal.aPIKeyFor", { label: managedProvider.label })}
                    />
                  </label>
                  <label className="stack-sm api-key-field">
                    <span className="text-sm">{t("providerManageModal.endpointUrl")}{needsEndpointUrl ? t("providerManageModal.required") : t("providerManageModal.optional")}</span>
                    <input
                      className="input"
                      type="url"
                      placeholder={managedProvider.defaultBaseUrl ?? t("providerManageModal.httpsApiExampleComV1")}
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      title={t("providerManageModal.aPIBaseUrlUsedFor")}
                    />
                    {needsEndpointUrl ? (
                      <span className="text-sm text-muted">
                        {t("providerManageModal.thisProviderSBespokeApi")}
                      </span>
                    ) : null}
                  </label>
                  {loginError ? <p className="text-danger text-sm">{loginError}</p> : null}
                  <div className="row gap-sm row-end">
                    <button
                      className="btn"
                      type="button"
                      title={t("providerManageModal.cancelAndCloseTheApi")}
                      onClick={() => setShowApiKeyModal(false)}
                    >
                      {t("providerManageModal.cancel")}
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      title={t("providerManageModal.saveApiKeyAndConnect")}
                      disabled={!apiKey.trim() || (needsEndpointUrl && !baseUrl.trim()) || savingCred}
                      onClick={() => void handleSaveCredential()}
                    >
                      {savingCred ? t("providerManageModal.saving") : t("providerManageModal.saveApiKey")}
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
