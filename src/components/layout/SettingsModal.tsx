import { useEffect, useState } from "react";
import { Bell, Check, Download, Globe, Lightbulb, Lock, Plug, RefreshCw, Settings2, Shield, Sparkles, Sun, Trash2, Unplug, User, Wrench, X } from "lucide-react";
import { ConfigPanel } from "../panels/ConfigPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import { CopyButton } from "./CopyButton";
import { FinalTouchesTab } from "./FinalTouchesTab";
import { OpenSpecSettingsTab } from "./OpenSpecSettingsTab";
import { PlanningTab } from "./PlanningTab";
import { OptionList } from "./OptionList";
import { RuntimeDefaultsFields } from "./RuntimeDefaultsFields";
import { listRequirements, type RequirementStatus } from "../../lib/requirements";
import { appVersion } from "../../lib/app";
import type { UpdaterState } from "../../state/updater";
import type { AccountState } from "../../state/account";
import {
  nativeProviderCatalog,
  type NativeProviderCatalog,
} from "../../lib/native-chat";
import {
  getRuntimeDefaults,
  setRuntimeDefaults,
  resetRuntimeDefaults,
  getPermissionRules,
  setPermissionRules,
  resetPermissionRules,
  listRuntimeProfiles,
  validateRuntimeProfile,
  type RuntimeDefaults,
  type PermissionRules,
  type PermissionDecision,
  type RuntimeProfile,
  type ProfileValidation,
  getApprovalMode,
  setApprovalMode,
  listApprovalRules,
  addApprovalRule,
  removeApprovalRule,
  listAuditTrail,
  clearAuditTrail,
  type ApprovalMode,
  type ApprovalRule,
  type AuditEntry,
} from "../../lib/settings";
 import {
  getAnalyticsConsent,
  setAnalyticsConsent,
  analyticsEventCount,
  deleteAnalyticsEvents,
  exportAnalyticsJson,
  type AnalyticsConsent,
} from "../../lib/analytics";
import {
  deleteExecutionAdviceFeedback,
  exportExecutionAdviceFeedback,
  getExecutionAdviceFeedbackConsent,
  listExecutionAdviceFeedback,
  setExecutionAdviceFeedbackConsent,
  type AdvisorFeedbackConsent,
} from "../../lib/execution-advisor";
import { startupGetStatus, startupEnable, startupDisable, startupReconcile, type StartupRegistrationStatus } from "../../lib/startup";
import {
  mcpReload,
  mcpListServers,
  mcpDisconnect,
  mcpOAuthStart,
  mcpOAuthPoll,
  mcpOAuthCancel,
  type ServerState as McpServerState,
  type LoadResult as McpLoadResult,
} from "../../lib/mcp";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { ModalPortal } from "../ModalPortal";
import { AccountPanel, UsageSyncPanel } from "./settings/AccountTab";
import { ModelProvidersPanel } from "./settings/ModelProvidersPanel";
import { ConcurrencyTab } from "./settings/ConcurrencyTab";
import { NotificationsTab } from "./settings/NotificationsTab";
import { SkillsTab } from "./settings/SkillsTab";
import { AppearanceTab } from "./settings/AppearanceTab";
import { LoadingBlock, SkeletonControl, SkeletonRows } from "./Loading";
import { t } from "../../i18n";
import { formatDateTime } from "../../i18n/format";

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
  projectPath: string | null;
  account: AccountState;
  updates: UpdaterState;
  /** Tab to open on. Applied each time the modal transitions to open. */
  initialTab?: Tab;
};

type Tab = "updates" | "providers" | "defaults" | "permissions" | "analytics" | "appearance" | "account" | "configs" | "mcp" | "planning" | "openspec" | "final_touches" | "concurrency" | "notifications" | "skills" | "about";

export function SettingsModal({ open, onClose, projectPath, account, updates, initialTab }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("updates");
  useEscapeKey(open, onClose);
  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);
  const [requirements, setRequirements] = useState<RequirementStatus[]>([]);
  // True until the first requirement sweep settles; the Updates tab must not
  // claim "No requirement checks available." before then.
  const [loading, setLoading] = useState(true);
  // App version — compiled in at build time. Shows "0.0.0" in dev; the real
  // version in release builds (set by .github/workflows/windows.yml).
  const [version, setVersion] = useState("");

  // Defaults state
  const [defaults, setDefaults] = useState<RuntimeDefaults | null>(null);
  const [profiles, setProfiles] = useState<RuntimeProfile[]>([]);
  const [profileValidations, setProfileValidations] = useState<Record<string, ProfileValidation>>({});
  const [catalog, setCatalog] = useState<NativeProviderCatalog | null>(null);
  // Cleared once, by the first defaults fetch — later resets keep the form.
  const [defaultsLoading, setDefaultsLoading] = useState(true);
  // Startup (launch at sign-in) state
  const [startupStatus, setStartupStatus] = useState<StartupRegistrationStatus | null>(null);
  const [startupToggling, setStartupToggling] = useState(false);
  // Cleared once, by the first status fetch — a failed fetch must fall through
  // to real content rather than spin forever.
  const [startupLoading, setStartupLoading] = useState(true);

  // Permissions state
  const [permissions, setPermissions] = useState<PermissionRules | null>(null);
  const [permissionsLoading, setPermissionsLoading] = useState(true);

  // Approval gateway state
  const [approvalMode, setApprovalModeState] = useState<ApprovalMode>("balanced");
  const [approvalRules, setApprovalRules] = useState<ApprovalRule[]>([]);
  const [auditTrail, setAuditTrail] = useState<AuditEntry[]>([]);
  // Cleared once, by the first approval fetch — later refreshes keep the rows.
  const [approvalLoading, setApprovalLoading] = useState(true);
  const [newRuleTool, setNewRuleTool] = useState("");
  const [newRulePrefix, setNewRulePrefix] = useState("");
  const [newRuleDecision, setNewRuleDecision] = useState<PermissionDecision>("ask");

  // Analytics state
  const [consent, setConsent] = useState<AnalyticsConsent | null>(null);
  const [consentLoading, setConsentLoading] = useState(true);
  const [eventCount, setEventCount] = useState(0);
  const [advisorFeedbackConsent, setAdvisorFeedbackConsent] = useState<AdvisorFeedbackConsent | null>(null);
  const [advisorFeedbackCount, setAdvisorFeedbackCount] = useState(0);

  // MCP state
  const [mcpServers, setMcpServers] = useState<McpServerState[]>([]);
  const [mcpErrors, setMcpErrors] = useState<string[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  // Distinct from `mcpLoading`: false only before the first reload settles, so
  // a user-triggered Reload keeps the current rows instead of blanking them.
  const [mcpLoaded, setMcpLoaded] = useState(false);
  const [oauthPollUrl, setOauthPollUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void refreshReq();
    void appVersion().then(setVersion).catch(() => {});
    void refreshDefaults();
    void refreshPermissions();
    void refreshAnalytics();
    void refreshApproval(projectPath);
    if (projectPath) void refreshMcp();
    void refreshStartupStatus();
  }, [open, projectPath]);

  async function refreshReq() {
    setLoading(true);
    try {
      setRequirements(await listRequirements());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function refreshMcp() {
    if (!projectPath) return;
    setMcpLoading(true);
    try {
      const result = await mcpReload(projectPath);
      setMcpServers(await mcpListServers(projectPath));
      setMcpErrors(result.errors.map((e) => `${e.file}: ${e.server}: ${e.message}`));
    } catch {
      // ignore
    } finally {
      setMcpLoading(false);
      setMcpLoaded(true);
    }
  }

  async function refreshDefaults() {
    try {
      const [d, p, c] = await Promise.all([
        getRuntimeDefaults(),
        listRuntimeProfiles(),
        nativeProviderCatalog(),
      ]);
      setDefaults(d);
      setProfiles(p);
      setCatalog(c);
      // Validate all profiles
      const validations: Record<string, ProfileValidation> = {};
      for (const profile of p) {
        try {
          validations[profile.id] = await validateRuntimeProfile(profile);
        } catch {
          validations[profile.id] = { valid: false, version: null, error: t("settingsModal.validationFailed") };
        }
      }
      setProfileValidations(validations);
    } catch {
      // ignore
    } finally {
      setDefaultsLoading(false);
    }
  }

  async function refreshPermissions() {
    try {
      setPermissions(await getPermissionRules());
    } catch {
      // ignore — the render falls through to the unavailable notice.
    } finally {
      setPermissionsLoading(false);
    }
  }

  async function refreshApproval(projectPath: string | null) {
    if (!projectPath) {
      setApprovalLoading(false);
      return;
    }
    try {
      const [mode, rules, audit] = await Promise.all([
        getApprovalMode(projectPath),
        listApprovalRules(projectPath),
        listAuditTrail(50),
      ]);
      setApprovalModeState(mode);
      setApprovalRules(rules);
      setAuditTrail(audit);
    } catch {
      // ignore
    } finally {
      setApprovalLoading(false);
    }
  }

  async function refreshAnalytics() {
    try {
      const [c, count, feedbackConsent, feedback] = await Promise.all([
        getAnalyticsConsent(),
        analyticsEventCount(),
        getExecutionAdviceFeedbackConsent(),
        listExecutionAdviceFeedback(),
      ]);
      setConsent(c);
      setEventCount(count);
      setAdvisorFeedbackConsent(feedbackConsent);
      setAdvisorFeedbackCount(feedback.length);
    } catch {
      // ignore — the render falls through to the unavailable notice.
    } finally {
      setConsentLoading(false);
    }
  }

  async function refreshStartupStatus() {
    try {
      const status = await startupGetStatus();
      setStartupStatus(status);
    } catch {
      // ignore — startup status is non-blocking
    } finally {
      setStartupLoading(false);
    }
  }

  async function toggleStartup(enable: boolean) {
    setStartupToggling(true);
    try {
      const status = enable ? await startupEnable() : await startupDisable();
      setStartupStatus(status);
    } catch {
      // ignore — user can retry
    } finally {
      setStartupToggling(false);
    }
  }

  async function retryStartupReconcile() {
    setStartupToggling(true);
    try {
      const status = await startupReconcile();
      setStartupStatus(status);
    } catch {
      // ignore
    } finally {
      setStartupToggling(false);
    }
  }


  async function saveDefaults(d: RuntimeDefaults) {
    try {
      await setRuntimeDefaults(d);
      setDefaults(d);
    } catch {
      // ignore
    }
  }

  async function savePermissions(p: PermissionRules) {
    try {
      await setPermissionRules(p);
      setPermissions(p);
    } catch {
      // ignore
    }
  }

  async function saveConsent(c: AnalyticsConsent) {
    const explicitConsent = {
      ...c,
      consentVersion: "usage-sharing-v1",
      consentedAt: Math.floor(Date.now() / 1000),
    };
    try {
      await setAnalyticsConsent(explicitConsent);
      setConsent(explicitConsent);
      await refreshAnalytics();
    } catch {
      // ignore
    }
  }

  async function deleteAnalytics() {
    try {
      await deleteAnalyticsEvents();
      await refreshAnalytics();
    } catch {
      // ignore
    }
  }

  async function exportAnalytics() {
    try {
      const json = await exportAnalyticsJson();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "basebuild-analytics-export.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }

  async function saveAdvisorFeedbackConsent(enabled: boolean) {
    try {
      setAdvisorFeedbackConsent(await setExecutionAdviceFeedbackConsent(enabled));
    } catch {
      // ignore
    }
  }

  async function deleteAdvisorFeedback() {
    try {
      await deleteExecutionAdviceFeedback();
      setAdvisorFeedbackCount(0);
    } catch {
      // ignore
    }
  }

  async function exportAdvisorFeedback() {
    try {
      const json = await exportExecutionAdviceFeedback();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "basebuild-execution-advisor-feedback.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }

  const chatProfiles = profiles.filter((p) => p.kind === "chat");
  const terminalProfiles = profiles.filter((p) => p.kind === "terminal");

  if (!open) return null;

  // Grouped sidebar: every tab belongs to exactly one named group;
  // Appearance leads so theme and UI scale are one click away.
  const tabGroups: { group: string; tabs: { id: Tab; label: string; icon: typeof Settings2 }[] }[] = [
    {
      group: t("settingsModal.appearance"),
      tabs: [
        { id: "appearance", label: t("settingsModal.appearance"), icon: Sun },
        { id: "notifications", label: t("settingsModal.notifications"), icon: Bell },
      ],
    },
    {
      group: t("settingsModal.general"),
      tabs: [
        { id: "updates", label: t("settingsModal.updates"), icon: RefreshCw },
        { id: "account", label: t("settingsModal.account"), icon: User },
        { id: "about", label: t("settingsModal.about"), icon: Globe },
      ],
    },
    {
      group: t("settingsModal.providersModels"),
      tabs: [
        { id: "providers", label: t("settingsModal.providers"), icon: Globe },
        { id: "defaults", label: t("settingsModal.defaults"), icon: Settings2 },
      ],
    },
    {
      group: t("settingsModal.execution"),
      tabs: [
        { id: "permissions", label: t("settingsModal.permissions"), icon: Lock },
        { id: "planning", label: t("settingsModal.planning"), icon: Lightbulb },
        { id: "openspec", label: t("settingsModal.openspec"), icon: Wrench },
        { id: "final_touches", label: t("settingsModal.finalTouches"), icon: Settings2 },
        { id: "concurrency", label: t("settingsModal.concurrency"), icon: Settings2 },
      ],
    },
    {
      group: t("settingsModal.integrations"),
      tabs: [
        { id: "mcp", label: t("settingsModal.mcpServers"), icon: Plug },
        { id: "configs", label: t("settingsModal.configPacks"), icon: Settings2 },
        { id: "skills", label: t("settingsModal.skills"), icon: Sparkles },
      ],
    },
    {
      group: t("settingsModal.privacyData"),
      tabs: [{ id: "analytics", label: t("settingsModal.analytics"), icon: Shield }],
    },
  ];

  const updateChecking = updates.status === "checking";
  const updateDownloading = updates.status === "downloading";
  const updateDownloaded = updates.status === "downloaded";
  const updateInstalling = updates.status === "installing";
  const updateBusy = updateDownloading || updateInstalling;
  // Latest version: explicit when an update is available; otherwise the
  // running version is the latest (up-to-date). Unknown until checked.
  const latestVersion =
    updates.info?.version ??
    (updates.status === "up_to_date" ? (version || "—") : "—");

  return (
    <ModalPortal>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("settingsModal.settings")}</h2>
          <button className="btn-icon" title={t("settingsModal.close")} type="button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="settings-sidebar">
            {tabGroups.map((group) => (
              <div key={group.group} className="settings-group">
                <span className="settings-group-label" title={t("settingsModal.settings2", { group: group.group })}>{group.group}</span>
                {group.tabs.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      className={`settings-tab${tab === t.id ? " is-active" : ""}`}
                      type="button"
                      title={t.label}
                      onClick={() => setTab(t.id)}
                    >
                      <Icon size={14} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="settings-content">
            {/* ─── Updates ─── */}
            {tab === "updates" ? (
              <div className="stack">
                <div className="settings-section-header">
                  <h3>{t("settingsModal.appUpdates")}</h3>
                  <button
                    className="btn btn-sm"
                    type="button"
                    title={t("settingsModal.checkForUpdatesNow")}
                    onClick={() => void updates.checkNow()}
                    disabled={updateChecking || updateBusy || updateDownloaded}
                  >
                    <RefreshCw size={12} className={updateChecking ? "spin" : ""} /> {t("settingsModal.checkForUpdates")}
                  </button>
                </div>
                <div className="update-version-grid">
                  <div className="update-version-cell">
                    <div className="text-muted text-sm">{t("settingsModal.installed")}</div>
                    <div className="mono">{version || "—"}</div>
                  </div>
                  <div className="update-version-cell">
                    <div className="text-muted text-sm">{t("settingsModal.latest")}</div>
                    <div className="mono">{latestVersion}</div>
                  </div>
                </div>
                {updates.info?.available ? (
                  <div className="requirement-row is-ok">
                    <span className="requirement-badge is-ok">↓</span>
                    <div>
                      <div className="requirement-name">{t("settingsModal.versionAvailable", { version: updates.info.version ?? "" })}</div>
                      {updates.info.notes ? <div className="requirement-detail text-muted text-sm update-notes">{updates.info.notes}</div> : null}
                      {updates.info.downloadUrl ? <div className="requirement-detail text-muted text-sm mono update-notes">{updates.info.downloadUrl}</div> : null}
                      {updateDownloaded || updateInstalling ? (
                        <button
                          className="btn btn-update btn-sm update-action-row"
                          type="button"
                          title={t("settingsModal.restartBasebuildToApplyThe")}
                          onClick={() => void updates.restartToApply()}
                          disabled={updateInstalling}
                        >
                          <RefreshCw size={12} className={updateInstalling ? "spin" : ""} /> {updateInstalling ? t("settingsModal.restarting") : t("settingsModal.restartToApplyUpdate")}
                        </button>
                      ) : (
                        <button
                          className="btn btn-update btn-sm update-action-row"
                          type="button"
                          title={t("settingsModal.downloadThisUpdateInThe")}
                          onClick={() => void updates.download()}
                          disabled={updateBusy}
                        >
                          <Download size={12} /> {updateDownloading ? t("settingsModal.downloading") : t("settingsModal.downloadUpdate")}
                        </button>
                      )}
                    </div>
                  </div>
                ) : updates.info ? (
                  <>
                    <p className={`text-sm${updates.status === "error" ? " text-danger" : " text-muted"}`}>
                      {updates.error ?? updates.info.notes ?? t("settingsModal.youReOnTheLatest")}
                    </p>
                    {updates.info.channelStatus && updates.info.channelStatus !== "ok" ? (
                      <div className="requirement-row is-warn">
                        <span className="requirement-badge is-warn">!</span>
                        <div>
                          <div className="requirement-name">{t("settingsModal.updateChannel", { channelStatus: updates.info.channelStatus })}</div>
                          {updates.info.rawError ? (
                            <details className="update-raw-error">
                              <summary className="text-muted text-sm">{t("settingsModal.rawUpdaterMessage")}</summary>
                              <pre className="text-sm mono">{updates.info.rawError}</pre>
                            </details>
                          ) : null}
                          {updates.info.rawError ? (
                            <CopyButton text={updates.info.rawError} label={t("settingsModal.copy")} className="btn btn-ghost btn-sm" />
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="text-muted text-sm">{t("settingsModal.checkingForUpdatesOnStartup")}</p>
                )}

                <div className="settings-section-header settings-section-spacer">
                  <h3>{t("settingsModal.windowsStartup")}</h3>
                </div>
                {startupLoading ? (
                  <LoadingBlock label={t("settingsModal.loadingStartupStatus")} compact />
                ) : startupStatus ? (
                  <div className="stack">
                    {startupStatus.platformSupported ? (
                      <>
                        <label className="row gap-sm">
                          <input
                            type="checkbox"
                            title={t("settingsModal.launchBasebuildAtWindowsSign")}
                            checked={startupStatus.desired}
                            disabled={startupToggling}
                            onChange={(e) => void toggleStartup(e.target.checked)}
                          />
                          <span className="text-sm">
                            {t("settingsModal.launchAtWindowsSignIn")}
                          </span>
                        </label>
                        <p className="text-muted text-sm">
                          {t("settingsModal.effectiveState", { state: startupStatus.effective })}
                          {startupStatus.desired && startupStatus.effective !== "enabled" ? (
                            <span className="text-danger"> {t("settingsModal.registrationMayHaveFailed")}</span>
                          ) : null}
                        </p>
                        {startupStatus.lastReconciliation && !startupStatus.lastReconciliation.success ? (
                          <div className="row gap-sm">
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              title={t("settingsModal.retryAutostartRegistration")}
                              disabled={startupToggling}
                              onClick={() => void retryStartupReconcile()}
                            >
                              <RefreshCw size={12} /> {t("settingsModal.retryRegistration")}
                            </button>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-muted text-sm">
                        {t("settingsModal.automaticStartupIsNotSupported")}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-muted text-sm">{t("settingsModal.startupStatusIsUnavailableRight")}</p>
                )}

                <div className="settings-section-header settings-section-spacer">
                  <h3>{t("settingsModal.requirementChecks")}</h3>
                  <button
                    className="btn-icon btn-icon-sm"
                    title={t("settingsModal.refreshRequirementChecks")}
                    type="button"
                    onClick={() => void refreshReq()}
                    disabled={loading}
                  >
                    <RefreshCw size={13} className={loading ? "spin" : ""} />
                  </button>
                </div>
                {loading && requirements.length === 0 ? (
                  <SkeletonRows rows={4} label={t("settingsModal.loadingRequirementChecks")} />
                ) : requirements.length === 0 ? (
                  <p className="text-muted">{t("settingsModal.noRequirementChecksAvailable")}</p>
                ) : (
                  requirements.map((req) => (
                    <div key={req.id} className={`requirement-row is-${req.severity}`}>
                      <span className={`requirement-badge is-${req.severity}`}>
                        {req.severity === "ok" ? "✓" : req.severity === "attention" ? "!" : "✕"}
                      </span>
                      <div>
                        <div className="requirement-name">{req.label}</div>
                        {req.message ? <div className="requirement-detail text-muted text-sm">{req.message}</div> : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            {/* ─── Defaults ─── */}
            {tab === "defaults" ? (
              <div className="stack">
                <h3>{t("settingsModal.runtimeDefaults")}</h3>
                <p className="text-muted text-sm">{t("settingsModal.setDefaultAdaptersForNew")}</p>

                {defaultsLoading ? (
                  <LoadingBlock label={t("settingsModal.loadingDefaults")} />
                ) : defaults ? (
                  <>
                    <RuntimeDefaultsFields
                      defaults={defaults}
                      chatProfiles={chatProfiles}
                      terminalProfiles={terminalProfiles}
                      profileValidations={profileValidations}
                      onChange={(d) => void saveDefaults(d)}
                    />

                    {defaults.defaultChatProfileId &&
                    profileValidations[defaults.defaultChatProfileId] &&
                    !profileValidations[defaults.defaultChatProfileId].valid ? (
                      <div className="requirement-row is-attention">
                        <span className="requirement-badge is-attention">!</span>
                        <div>
                          <div className="requirement-name">{t("settingsModal.selectedAdapterIsUnavailable")}</div>
                          <div className="requirement-detail text-muted text-sm">
                            {profileValidations[defaults.defaultChatProfileId].error ??
                              t("settingsModal.thisAdapterReportedUnavailableInstall")}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <label className="stack-sm">
                      <span className="text-sm text-muted">{t("settingsModal.defaultModelOptional")}</span>
                      <input
                        className="input"
                        type="text"
                        title={t("settingsModal.defaultModelNameForAdapters")}
                        placeholder={t("settingsModal.eGClaudeSonnet4")}
                        value={defaults.defaultModel ?? ""}
                        onChange={(e) => void saveDefaults({ ...defaults, defaultModel: e.target.value || null })}
                      />
                    </label>

                    <label className="row gap-sm mt-4">
                      <input
                        type="checkbox"
                        title={t("settingsModal.autoSendGeneratedPromptsDisabled")}
                        checked={defaults.autoSendGeneratedPrompts}
                        onChange={(e) => void saveDefaults({ ...defaults, autoSendGeneratedPrompts: e.target.checked })}
                      />
                      <span className="text-sm">{t("settingsModal.autoSendGeneratedPrompts")}</span>
                    </label>
                    <p className="text-muted text-sm mt-n4">
                      {t("settingsModal.whenEnabledPromptsFromThe")}
                    </p>

                    {/* GIT Ai — model used by Source → Generate commit */}
                    <div className="stack-sm mt-12">
                      <h4 className="text-sm text-muted mb-4">{t("settingsModal.gITAi")}</h4>
                      <p className="text-muted text-sm">
                        {t("settingsModal.modelUsedBySourceGenerate")}
                      </p>
                      <label className="row gap-sm mb-4">
                        <span className="text-sm label-w-64">{t("settingsModal.provider")}</span>
                        <select
                          className="input"
                          title={t("settingsModal.gITAiProviderUsedBy")}
                          value={defaults.gitAiProviderId ?? ""}
                          onChange={(e) => void saveDefaults({ ...defaults, gitAiProviderId: e.target.value || null, gitAiModelId: null })}
                        >
                          <option value="">{t("settingsModal.useChatDefault")}</option>
                          {(catalog?.providers ?? []).filter((p) => p.configured && !p.localOnly).map((p) => (
                            <option key={p.id} value={p.id}>{p.label}</option>
                          ))}
                        </select>
                      </label>
                      {defaults.gitAiProviderId ? (
                        <label className="row gap-sm">
                          <span className="text-sm label-w-64">{t("settingsModal.model")}</span>
                          <select
                            className="input"
                            title={t("settingsModal.gITAiModelUsedBy")}
                            value={defaults.gitAiModelId ?? ""}
                            onChange={(e) => void saveDefaults({ ...defaults, gitAiModelId: e.target.value || null })}
                          >
                            <option value="">{t("settingsModal.providerDefault")}</option>
                            {(catalog?.models ?? [])
                              .filter((m) => m.providerId === defaults.gitAiProviderId)
                              .map((m) => (
                                <option key={m.id} value={m.id}>{m.label}</option>
                              ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="text-muted text-sm">{t("settingsModal.runtimeDefaultsAreUnavailableRight")}</p>
                )}

                {/* Profile validation */}
                <div className="mt-12">
                  <h4 className="text-sm text-muted mb-6">{t("settingsModal.adapterHealth")}</h4>
                  {defaultsLoading ? (
                    <SkeletonRows rows={3} label={t("settingsModal.loadingAdapterHealth")} />
                  ) : (
                    profiles.map((p) => {
                      const v = profileValidations[p.id];
                      return (
                        <div key={p.id} className={`requirement-row is-${v?.valid ? "ok" : "attention"} requirement-row-compact`}>
                          <span className={`requirement-badge is-${v?.valid ? "ok" : "attention"}`}>
                            {v?.valid ? "✓" : "!"}
                          </span>
                          <div>
                            <div className="requirement-name">{p.label} <span className="text-muted text-sm mono">{p.executable}</span></div>
                            {v?.version ? <div className="requirement-detail text-muted text-sm">{v.version}</div> : null}
                            {v?.error ? <div className="requirement-detail text-danger text-sm">{v.error}</div> : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <button
                  className="btn btn-sm"
                  type="button"
                  title={t("settingsModal.resetRuntimeDefaultsToFactory")}
                  onClick={() => void resetRuntimeDefaults().then(() => void refreshDefaults())}
                >
                  <RefreshCw size={12} /> {t("settingsModal.resetToDefaults")}
                </button>
              </div>
            ) : null}

            {/* ─── Permissions ─── */}
            {tab === "permissions" ? (
              <div className="stack">
                <h3>{t("settingsModal.permissionRules")}</h3>
                <p className="text-muted text-sm">{t("settingsModal.controlWhatAgentActionsRequire")}</p>

                {permissionsLoading ? (
                  <LoadingBlock label={t("settingsModal.loadingPermissionRules")} />
                ) : permissions ? (
                  <>
                    <PermissionSelect
                      label={t("settingsModal.commandExecution")}
                      title={t("settingsModal.permissionForRunningCommandsOutside")}
                      value={permissions.allowCommandExecution}
                      onChange={(v) => void savePermissions({ ...permissions, allowCommandExecution: v })}
                    />
                    <PermissionSelect
                      label={t("settingsModal.externalFileContext")}
                      title={t("settingsModal.permissionForReadingFilesOutside")}
                      value={permissions.allowExternalContext}
                      onChange={(v) => void savePermissions({ ...permissions, allowExternalContext: v })}
                    />
                    <PermissionSelect
                      label={t("settingsModal.fileModification")}
                      title={t("settingsModal.permissionForModifyingFilesIn")}
                      value={permissions.allowFileModification}
                      onChange={(v) => void savePermissions({ ...permissions, allowFileModification: v })}
                    />
                  </>
                ) : (
                  <p className="text-muted text-sm">
                    {t("settingsModal.permissionRulesAreUnavailableRight")}
                  </p>
                )}

                <button
                  className="btn btn-sm"
                  type="button"
                  title={t("settingsModal.resetPermissionsToConservativeDefaults")}
                  onClick={() => void resetPermissionRules().then(() => void refreshPermissions())}
                >
                  <RefreshCw size={12} /> {t("settingsModal.resetToDefaults")}
                </button>

                {/* Approval Gateway */}
                <div className="stack approval-gateway-section">
                  <h4>{t("settingsModal.approvalGateway")}</h4>
                  <p className="text-muted text-sm">
                    {t("settingsModal.controlsHowTheAgentLoop")}
                  </p>

                  {approvalLoading ? (
                    <LoadingBlock label={t("settingsModal.loadingApprovalMode")} compact />
                  ) : (
                    <>
                      <div className="row gap-sm">
                        {(["safe", "balanced", "auto"] as ApprovalMode[]).map((m) => (
                          <button
                            key={m}
                            className={`btn btn-sm ${approvalMode === m ? "btn-primary" : ""}`}
                            type="button"
                            title={t("settingsModal.setApprovalModeTo", { m: m })}
                            onClick={() => {
                              setApprovalModeState(m);
                              if (projectPath) void setApprovalMode(projectPath, m).then(() => void refreshApproval(projectPath));
                            }}
                          >
                            {m === "safe" && <Lock size={12} />}
                            {m === "balanced" && <Shield size={12} />}
                            {m === "auto" && <Check size={12} />}
                            {m.charAt(0).toUpperCase() + m.slice(1)}
                          </button>
                        ))}
                      </div>
                      <p className="text-muted text-sm">
                        {approvalMode === "safe" && t("settingsModal.everyToolCallPromptsFor")}
                        {approvalMode === "balanced" && t("settingsModal.readOnlyToolsAutoAllow")}
                        {approvalMode === "auto" && t("settingsModal.allToolsAutoAllowWithin")}
                      </p>
                    </>
                  )}

                  {/* Custom rules */}
                  <div className="stack mt-8">
                    <h5>{t("settingsModal.customRules")}</h5>
                    {approvalLoading ? (
                      <SkeletonRows rows={2} label={t("settingsModal.loadingCustomApprovalRules")} />
                    ) : approvalRules.length === 0 ? (
                      <p className="text-muted text-sm">{t("settingsModal.noCustomRulesDefaultMode")}</p>
                    ) : (
                      <div className="stack">
                        {approvalRules.map((rule) => (
                          <div key={rule.id} className="row gap-sm align-center justify-between">
                            <span className="text-sm">
                              <strong>{rule.toolName}</strong>
                              {rule.commandPrefix ? <code className="text-muted"> {rule.commandPrefix}*</code> : null}
                              {" → "}
                              <span className={`badge badge-${rule.decision === "allow" ? "success" : rule.decision === "deny" ? "error" : "warning"}`}>
                              </span>
                            </span>
                            <button
                              className="btn btn-sm"
                              type="button"
                              title={t("settingsModal.removeThisRule")}
                              onClick={() => void removeApprovalRule(rule.id).then(() => projectPath && void refreshApproval(projectPath))}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add new rule */}
                    {projectPath ? (
                      <div className="row gap-sm align-center flex-wrap">
                        <input
                          className="input input-w-140"
                          placeholder={t("settingsModal.toolName")}
                          value={newRuleTool}
                          title={t("settingsModal.toolNameEGRun")}
                          onChange={(e) => setNewRuleTool(e.target.value)}
                        />
                        <input
                          className="input input-w-140"
                          placeholder={t("settingsModal.commandPrefixOptional")}
                          value={newRulePrefix}
                          title={t("settingsModal.onlyApplyToCommandsStarting")}
                          onChange={(e) => setNewRulePrefix(e.target.value)}
                        />
                        <OptionList
                          label={t("settingsModal.decisionForThisRule")}
                          value={newRuleDecision}
                          compact
                          onChange={setNewRuleDecision}
                          options={[
                            { id: "ask", label: t("settingsModal.ask"), title: t("settingsModal.askBeforeEachAction") },
                            { id: "allow", label: t("settingsModal.allow"), title: t("settingsModal.allowAutomatically") },
                            { id: "deny", label: t("settingsModal.deny"), title: t("settingsModal.denyAutomatically") },
                          ]}
                        />
                        <button
                          className="btn btn-sm btn-primary"
                          type="button"
                          title={t("settingsModal.addCustomApprovalRule")}
                          onClick={() => {
                            if (!newRuleTool.trim() || !projectPath) return;
                            void addApprovalRule({
                              id: `rule-${Date.now()}`,
                              projectPath,
                              toolName: newRuleTool.trim(),
                              commandPrefix: newRulePrefix.trim() || null,
                              decision: newRuleDecision,
                              createdAt: Math.floor(Date.now() / 1000),
                            }).then(() => {
                              setNewRuleTool("");
                              setNewRulePrefix("");
                              void refreshApproval(projectPath);
                            });
                          }}
                        >
                          {t("settingsModal.addRule")}
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {/* Audit trail */}
                  <div className="stack mt-12">
                    <div className="row align-center justify-between">
                      <h5>{t("settingsModal.auditTrail")}</h5>
                      <button
                        className="btn btn-sm"
                        type="button"
                        title={t("settingsModal.clearAuditTrail")}
                        onClick={() => void clearAuditTrail().then(() => void refreshApproval(projectPath))}
                      >
                        <Trash2 size={12} /> {t("settingsModal.clear")}
                      </button>
                    </div>
                    {approvalLoading ? (
                      <SkeletonRows rows={3} label={t("settingsModal.loadingAuditTrail")} />
                    ) : auditTrail.length === 0 ? (
                      <p className="text-muted text-sm">{t("settingsModal.noAuditEntriesYet")}</p>
                    ) : (
                      <div className="stack scroll-y-200">
                        {auditTrail.map((entry) => (
                          <div key={entry.id} className="text-sm audit-entry">
                            <span className={`badge badge-${entry.decision === "allow" ? "success" : entry.decision === "deny" ? "error" : "warning"}`}>
                              {entry.decision}
                            </span>{" "}
                            <strong>{entry.action}</strong>
                            {entry.scope ? <code className="text-muted"> {entry.scope}</code> : null}
                            {entry.sourceWorkflow ? <span className="text-muted"> ({entry.sourceWorkflow})</span> : null}
                            {" "}
                            <span className="text-muted text-xs">{formatDateTime(new Date(entry.createdAt * 1000))}</span>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
                </div>
              </div>
            ) : null}

            {/* ─── Privacy ─── */}
            {tab === "analytics" ? (
              <div className="stack">
                <h3>{t("settingsModal.analyticsUsage")}</h3>
                <p className="text-muted text-sm">
                  {t("settingsModal.basebuildIsLocalFirstLocal")}
                </p>

                <UsageSyncPanel />


                {consentLoading ? (
                  <LoadingBlock label={t("settingsModal.loadingAnalyticsConsent")} />
                ) : consent ? (
                  <>
                    <label className="row gap-sm mt-4">
                      <input
                        type="checkbox"
                        title={t("settingsModal.enableLocalUsageAnalyticsStored")}
                        checked={consent.collectionEnabled}
                        onChange={(e) => void saveConsent({ ...consent, collectionEnabled: e.target.checked })}
                      />
                      <span className="text-sm">{t("settingsModal.enableLocalUsageAnalytics")}</span>
                    </label>
                    <p className="text-muted text-sm mt-n4">
                      {t("settingsModal.storesPrivacySafeMetadataEvent")}
                    </p>

                    <label className="row gap-sm mt-4">
                      <input
                        type="checkbox"
                        title={t("settingsModal.shareAnonymousAggregateModelAnd")}
                        checked={consent.uploadEnabled}
                        onChange={(e) => void saveConsent({ ...consent, uploadEnabled: e.target.checked })}
                      />
                      <span className="text-sm">{t("settingsModal.shareAnonymousAggregateUsage")}</span>
                    </label>
                    <p className="text-muted text-sm mt-n4">
                      {t("settingsModal.independentOfLocalFeatureAnalytics")}
                    </p>

                    <div className="mt-8">
                      <h4 className="text-sm text-muted mb-6">{t("settingsModal.localAnalyticsData")}</h4>
                      <div className="row gap-sm">
                        <span className="text-sm mono">{t("settingsModal.eventsStored", { eventCount: eventCount })}</span>
                        <button
                          className="btn btn-sm"
                          type="button"
                          title={t("settingsModal.exportLocalAnalyticsDataAs")}
                          onClick={() => void exportAnalytics()}
                          disabled={eventCount === 0}
                        >
                          <Download size={12} /> {t("settingsModal.export")}
                        </button>
                        <button
                          className="btn btn-sm"
                          type="button"
                          title={t("settingsModal.deleteAllLocalAnalyticsEvents")}
                          onClick={() => void deleteAnalytics()}
                          disabled={eventCount === 0}
                        >
                          <Trash2 size={12} /> {t("settingsModal.delete")}
                        </button>
                      </div>
                    </div>

                    <div className="mt-8">
                      <h4 className="text-sm text-muted mb-6">{t("settingsModal.executionRecommendationFeedback")}</h4>
                      <label className="row gap-sm">
                        {/* Its own fetch, independent of the consent block
                            above. Unchecked-and-disabled reads as "opted
                            out", which is a decision the user did not make. */}
                        {advisorFeedbackConsent ? (
                          <input
                            type="checkbox"
                            title={t("settingsModal.separatelyOptInToFixed")}
                            checked={advisorFeedbackConsent.enabled}
                            onChange={(event) => void saveAdvisorFeedbackConsent(event.target.checked)}
                          />
                        ) : (
                          <SkeletonControl label={t("settingsModal.theRecommendationFeedbackSetting")} />
                        )}
                        <span className="text-sm">{t("settingsModal.collectRecommendationChoices")}</span>
                      </label>
                      <p className="text-muted text-sm mt-n4">
                        {t("settingsModal.offByDefaultStoresOnly")}
                      </p>
                      <p className="text-muted text-sm">
                        {t("settingsModal.remoteUploadAdditionallyRequiresAnonymous")}
                      </p>
                      <div className="row gap-sm">
                        <span className="text-sm mono">{t("settingsModal.choicesStored", { advisorFeedbackCount: advisorFeedbackCount })}</span>
                        <button
                          className="btn btn-sm"
                          type="button"
                          title={t("settingsModal.inspectExecutionRecommendationFeedbackBy")}
                          onClick={() => void exportAdvisorFeedback()}
                          disabled={advisorFeedbackCount === 0}
                        >
                          <Download size={12} /> {t("settingsModal.export")}
                        </button>
                        <button
                          className="btn btn-sm"
                          type="button"
                          title={t("settingsModal.deleteAllLocalExecutionRecommendation")}
                          onClick={() => void deleteAdvisorFeedback()}
                          disabled={advisorFeedbackCount === 0}
                        >
                          <Trash2 size={12} /> {t("settingsModal.delete")}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-muted text-sm">{t("settingsModal.analyticsSettingsAreUnavailableRight")}</p>
                )}

                {consent && !consent.collectionEnabled ? (
                  <div className="requirement-row is-ok mt-8">
                    <span className="requirement-badge is-ok">✓</span>
                    <div>
                      <div className="requirement-name">{t("settingsModal.analyticsDisabled")}</div>
                      <div className="text-muted text-sm">{t("settingsModal.noDataLeavesThisDevice")}</div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ─── Appearance ─── */}
            {tab === "appearance" ? <AppearanceTab /> : null}

            {/* ─── Config Packs ─── */}
            {tab === "configs" ? <ConfigPanel projectPath={projectPath} /> : null}

            {/* ─── MCP Servers ─── */}
            {tab === "mcp" ? (
              <div className="stack">
                <div className="settings-section-header">
                  <h3>{t("settingsModal.mCPServers")}</h3>
                  <button
                    className="btn btn-sm"
                    type="button"
                    title={t("settingsModal.reloadMcpServerConfigsFrom")}
                    disabled={mcpLoading || !projectPath}
                    onClick={() => void refreshMcp()}
                  >
                    <RefreshCw size={14} />
                    {t("settingsModal.reload")}
                  </button>
                </div>
                <p className="text-muted text-sm">
                  {t("settingsModal.mCPServersAreDefinedIn")} <code>{t("settingsModal.ompMcpJson")}</code> {t("settingsModal.projectOr")} <code>{t("settingsModal.ompAgentMcpJson")}</code> {t("settingsModal.userConfigureOnceSharedWith")}
                </p>
                {mcpErrors.length > 0 ? (
                  <div className="callout callout-warn">
                    {mcpErrors.map((e, i) => (
                      <div key={i}>{e}</div>
                    ))}
                  </div>
                ) : null}
                {projectPath && !mcpLoaded ? (
                  <SkeletonRows rows={3} label={t("settingsModal.loadingMcpServers")} />
                ) : mcpServers.length === 0 ? (
                  <p className="text-muted text-sm">{t("settingsModal.noMcpServersConfigured")}</p>
                ) : (
                  <div className="stack">
                    {mcpServers.map((s) => (
                      <div key={s.name} className="settings-row">
                        <div className="settings-row-info">
                          <div className="settings-row-label">{s.name}</div>
                          <div className="text-muted text-sm">
                            {s.source} · {s.state}
                            {s.toolCount > 0 ? t("settingsModal.tools", { toolCount: s.toolCount }) : ""}
                            {s.promptCount > 0 ? t("settingsModal.prompts", { promptCount: s.promptCount }) : ""}
                            {s.error ? t("settingsModal.text", { error: s.error }) : ""}
                          </div>
                        </div>
                        <div className="settings-row-actions">
                          {s.state === "connected" ? (
                            <button
                              className="btn btn-sm"
                              type="button"
                              title={t("settingsModal.disconnectThisServer")}
                              disabled={!projectPath}
                              onClick={() => {
                                if (!projectPath) return;
                                void mcpDisconnect(projectPath, s.name).then(() => refreshMcp());
                              }}
                            >
                              <Unplug size={14} />
                              {t("settingsModal.disconnect")}
                            </button>
                          ) : (
                            <button
                              className="btn btn-sm"
                              type="button"
                              title={t("settingsModal.reconnectThisServer")}
                              disabled={mcpLoading || !projectPath}
                              onClick={() => void refreshMcp()}
                            >
                              <RefreshCw size={14} />
                              {t("settingsModal.connect")}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {/* ─── Account ─── */}
            {tab === "account" ? (
              <div className="stack">
                <AccountPanel account={account} />
              </div>
            ) : null}

            {tab === "providers" ? <ModelProvidersPanel /> : null}

            {tab === "planning" ? (
              <PlanningTab projectPath={projectPath} />
            ) : null}

            {tab === "openspec" ? (
              <OpenSpecSettingsTab projectPath={projectPath} />
            ) : null}

            {tab === "final_touches" ? (
              <FinalTouchesTab projectPath={projectPath} />
            ) : null}

            {tab === "notifications" ? (
              <NotificationsTab />
            ) : null}

            {/* ─── Concurrency ─── */}
            {tab === "concurrency" ? (
              <ConcurrencyTab projectPath={projectPath} />
            ) : null}

            {/* ─── Skills ─── */}
            {tab === "skills" ? (
              <SkillsTab />
            ) : null}

            {/* ─── About ─── */}
            {tab === "about" ? (
              <div className="stack">
                <h3>{t("settingsModal.basebuild")}</h3>
                <p className="text-muted">{t("settingsModal.version", { version: version || "…" })}</p>
                <p className="text-muted text-sm">
                  {t("settingsModal.desktopApplicationForManagingOmp")}
                </p>
                <div className="stack-sm mt-8">
                  <a className="text-sm" href="https://basebuild.net" target="_blank" rel="noopener noreferrer" title={t("settingsModal.visitBasebuildNet")}>{t("settingsModal.basebuildNet")}</a>
                  <a className="text-sm" href="https://github.com/basebuild-net/basebuild" target="_blank" rel="noopener noreferrer" title={t("settingsModal.visitGithubRepository")}>{t("settingsModal.githubComBasebuildNetBasebuild")}</a>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

function PermissionSelect({ label, title, value, onChange }: {
  label: string;
  title: string;
  value: PermissionDecision;
  onChange: (v: PermissionDecision) => void;
}) {
  return (
    <label className="stack-sm mb-8" title={title}>
      <span className="text-sm text-muted">{label}</span>
      <OptionList
        label={label}
        value={value}
        compact
        onChange={onChange}
        options={[
          { id: "ask", label: t("settingsModal.askBeforeEachAction"), title: t("settingsModal.askBeforeEachAction") },
          { id: "allow", label: t("settingsModal.allowAutomatically"), title: t("settingsModal.allowAutomatically") },
          { id: "deny", label: t("settingsModal.denyAutomatically"), title: t("settingsModal.denyAutomatically") },
        ]}
      />
    </label>
  );
}