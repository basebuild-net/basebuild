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

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
  projectPath: string | null;
  account: AccountState;
  updates: UpdaterState;
};

type Tab = "updates" | "providers" | "defaults" | "permissions" | "privacy" | "appearance" | "account" | "configs" | "mcp" | "planning" | "openspec" | "final_touches" | "concurrency" | "notifications" | "skills" | "about";

export function SettingsModal({ open, onClose, projectPath, account, updates }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("updates");
  useEscapeKey(open, onClose);
  const [requirements, setRequirements] = useState<RequirementStatus[]>([]);
  const [loading, setLoading] = useState(false);
  // App version — compiled in at build time. Shows "0.0.0" in dev; the real
  // version in release builds (set by .github/workflows/windows.yml).
  const [version, setVersion] = useState("");

  // Defaults state
  const [defaults, setDefaults] = useState<RuntimeDefaults | null>(null);
  const [profiles, setProfiles] = useState<RuntimeProfile[]>([]);
  const [profileValidations, setProfileValidations] = useState<Record<string, ProfileValidation>>({});
  const [catalog, setCatalog] = useState<NativeProviderCatalog | null>(null);
  // Startup (launch at sign-in) state
  const [startupStatus, setStartupStatus] = useState<StartupRegistrationStatus | null>(null);
  const [startupToggling, setStartupToggling] = useState(false);

  // Permissions state
  const [permissions, setPermissions] = useState<PermissionRules | null>(null);

  // Approval gateway state
  const [approvalMode, setApprovalModeState] = useState<ApprovalMode>("auto");
  const [approvalRules, setApprovalRules] = useState<ApprovalRule[]>([]);
  const [auditTrail, setAuditTrail] = useState<AuditEntry[]>([]);
  const [newRuleTool, setNewRuleTool] = useState("");
  const [newRulePrefix, setNewRulePrefix] = useState("");
  const [newRuleDecision, setNewRuleDecision] = useState<PermissionDecision>("ask");

  // Analytics state
  const [consent, setConsent] = useState<AnalyticsConsent | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [advisorFeedbackConsent, setAdvisorFeedbackConsent] = useState<AdvisorFeedbackConsent | null>(null);
  const [advisorFeedbackCount, setAdvisorFeedbackCount] = useState(0);

  // MCP state
  const [mcpServers, setMcpServers] = useState<McpServerState[]>([]);
  const [mcpErrors, setMcpErrors] = useState<string[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [oauthPollUrl, setOauthPollUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void refreshReq();
    void appVersion().then(setVersion).catch(() => {});
    void refreshDefaults();
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
          validations[profile.id] = { valid: false, version: null, error: "Validation failed" };
        }
      }
      setProfileValidations(validations);
    } catch {
      // ignore
    }
  }

  async function refreshPermissions() {
    try {
      setPermissions(await getPermissionRules());
    } catch {
      // ignore
    }
  }

  async function refreshApproval(projectPath: string | null) {
    if (!projectPath) return;
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
      // ignore
    }
  }

  async function refreshStartupStatus() {
    try {
      const status = await startupGetStatus();
      setStartupStatus(status);
    } catch {
      // ignore — startup status is non-blocking
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
    try {
      await setAnalyticsConsent(c);
      setConsent(c);
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
      group: "Appearance",
      tabs: [
        { id: "appearance", label: "Appearance", icon: Sun },
        { id: "notifications", label: "Notifications", icon: Bell },
      ],
    },
    {
      group: "General",
      tabs: [
        { id: "updates", label: "Updates", icon: RefreshCw },
        { id: "account", label: "Account", icon: User },
        { id: "about", label: "About", icon: Globe },
      ],
    },
    {
      group: "Providers & Models",
      tabs: [
        { id: "providers", label: "Providers", icon: Globe },
        { id: "defaults", label: "Defaults", icon: Settings2 },
      ],
    },
    {
      group: "Execution",
      tabs: [
        { id: "permissions", label: "Permissions", icon: Lock },
        { id: "planning", label: "Planning", icon: Lightbulb },
        { id: "openspec", label: "OpenSpec", icon: Wrench },
        { id: "final_touches", label: "Final Touches", icon: Settings2 },
        { id: "concurrency", label: "Concurrency", icon: Settings2 },
      ],
    },
    {
      group: "Integrations",
      tabs: [
        { id: "mcp", label: "MCP Servers", icon: Plug },
        { id: "configs", label: "Config Packs", icon: Settings2 },
        { id: "skills", label: "Skills", icon: Sparkles },
      ],
    },
    {
      group: "Privacy & Data",
      tabs: [{ id: "privacy", label: "Privacy", icon: Shield }],
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
          <h2>Settings</h2>
          <button className="btn-icon" title="Close" type="button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="settings-sidebar">
            {tabGroups.map((group) => (
              <div key={group.group} className="settings-group">
                <span className="settings-group-label" title={`${group.group} settings`}>{group.group}</span>
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
                  <h3>App Updates</h3>
                  <button
                    className="btn btn-sm"
                    type="button"
                    title="Check for updates now"
                    onClick={() => void updates.checkNow()}
                    disabled={updateChecking || updateBusy || updateDownloaded}
                  >
                    <RefreshCw size={12} className={updateChecking ? "spin" : ""} /> Check for updates
                  </button>
                </div>
                <div className="update-version-grid">
                  <div className="update-version-cell">
                    <div className="text-muted text-sm">Installed</div>
                    <div className="mono">{version || "—"}</div>
                  </div>
                  <div className="update-version-cell">
                    <div className="text-muted text-sm">Latest</div>
                    <div className="mono">{latestVersion}</div>
                  </div>
                </div>
                {updates.info?.available ? (
                  <div className="requirement-row is-ok">
                    <span className="requirement-badge is-ok">↓</span>
                    <div>
                      <div className="requirement-name">Version {updates.info.version} available</div>
                      {updates.info.notes ? <div className="requirement-detail text-muted text-sm update-notes">{updates.info.notes}</div> : null}
                      {updates.info.downloadUrl ? <div className="requirement-detail text-muted text-sm mono update-notes">{updates.info.downloadUrl}</div> : null}
                      {updateDownloaded || updateInstalling ? (
                        <button
                          className="btn btn-update btn-sm update-action-row"
                          type="button"
                          title="Restart Basebuild to apply the downloaded update"
                          onClick={() => void updates.restartToApply()}
                          disabled={updateInstalling}
                        >
                          <RefreshCw size={12} className={updateInstalling ? "spin" : ""} /> {updateInstalling ? "Restarting…" : "Restart to apply update"}
                        </button>
                      ) : (
                        <button
                          className="btn btn-update btn-sm update-action-row"
                          type="button"
                          title="Download this update in the background — it applies when you restart"
                          onClick={() => void updates.download()}
                          disabled={updateBusy}
                        >
                          <Download size={12} /> {updateDownloading ? "Downloading…" : "Download update"}
                        </button>
                      )}
                    </div>
                  </div>
                ) : updates.info ? (
                  <>
                    <p className={`text-sm${updates.status === "error" ? " text-danger" : " text-muted"}`}>
                      {updates.error ?? updates.info.notes ?? "You're on the latest version."}
                    </p>
                    {updates.info.channelStatus && updates.info.channelStatus !== "ok" ? (
                      <div className="requirement-row is-warn">
                        <span className="requirement-badge is-warn">!</span>
                        <div>
                          <div className="requirement-name">Update channel: {updates.info.channelStatus}</div>
                          {updates.info.rawError ? (
                            <details className="update-raw-error">
                              <summary className="text-muted text-sm">Raw updater message</summary>
                              <pre className="text-sm mono">{updates.info.rawError}</pre>
                            </details>
                          ) : null}
                          {updates.info.rawError ? (
                            <CopyButton text={updates.info.rawError} label="Copy" className="btn btn-ghost btn-sm" />
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="text-muted text-sm">Checking for updates on startup and every 5 minutes.</p>
                )}

                <div className="settings-section-header settings-section-spacer">
                  <h3>Windows Startup</h3>
                </div>
                {startupStatus ? (
                  <div className="stack">
                    {startupStatus.platformSupported ? (
                      <>
                        <label className="row gap-sm">
                          <input
                            type="checkbox"
                            title="Launch Basebuild at Windows sign-in (minimized to tray)"
                            checked={startupStatus.desired}
                            disabled={startupToggling}
                            onChange={(e) => void toggleStartup(e.target.checked)}
                          />
                          <span className="text-sm">
                            Launch at Windows sign-in (minimized to tray)
                          </span>
                        </label>
                        <p className="text-muted text-sm">
                          Effective state: {startupStatus.effective}
                          {startupStatus.desired && startupStatus.effective !== "enabled" ? (
                            <span className="text-danger"> — registration may have failed</span>
                          ) : null}
                        </p>
                        {startupStatus.lastReconciliation && !startupStatus.lastReconciliation.success ? (
                          <div className="row gap-sm">
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              title="Retry autostart registration"
                              disabled={startupToggling}
                              onClick={() => void retryStartupReconcile()}
                            >
                              <RefreshCw size={12} /> Retry registration
                            </button>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-muted text-sm">
                        Automatic startup is not supported on this platform.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-muted text-sm">Loading startup status…</p>
                )}

                <div className="settings-section-header settings-section-spacer">
                  <h3>Requirement Checks</h3>
                  <button
                    className="btn-icon btn-icon-sm"
                    title="Refresh requirement checks"
                    type="button"
                    onClick={() => void refreshReq()}
                    disabled={loading}
                  >
                    <RefreshCw size={13} className={loading ? "spin" : ""} />
                  </button>
                </div>
                {requirements.length === 0 ? (
                  <p className="text-muted">No requirement checks available.</p>
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
                <h3>Runtime Defaults</h3>
                <p className="text-muted text-sm">Set default adapters for new chat and terminal tabs. These are local-only.</p>

                {defaults ? (
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
                          <div className="requirement-name">Selected adapter is unavailable</div>
                          <div className="requirement-detail text-muted text-sm">
                            {profileValidations[defaults.defaultChatProfileId].error ??
                              "This adapter reported unavailable. Install it or pick an available adapter; new chats fall back to an available one."}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <label className="stack-sm">
                      <span className="text-sm text-muted">Default model (optional)</span>
                      <input
                        className="input"
                        type="text"
                        title="Default model name for adapters that support model selection"
                        placeholder="e.g. claude-sonnet-4-20250514"
                        value={defaults.defaultModel ?? ""}
                        onChange={(e) => void saveDefaults({ ...defaults, defaultModel: e.target.value || null })}
                      />
                    </label>

                    <label className="row gap-sm mt-4">
                      <input
                        type="checkbox"
                        title="Auto-send generated prompts — disabled by default for safety"
                        checked={defaults.autoSendGeneratedPrompts}
                        onChange={(e) => void saveDefaults({ ...defaults, autoSendGeneratedPrompts: e.target.checked })}
                      />
                      <span className="text-sm">Auto-send generated prompts</span>
                    </label>
                    <p className="text-muted text-sm mt-n4">
                      When enabled, prompts from the chat planning menu are sent immediately. Disabled by default.
                    </p>

                    {/* GIT Ai — model used by Source → Generate commit */}
                    <div className="stack-sm mt-12">
                      <h4 className="text-sm text-muted mb-4">GIT Ai</h4>
                      <p className="text-muted text-sm">
                        Model used by Source → Generate commit. Only configured providers are listed. Falls back to your chat default when unset.
                      </p>
                      <label className="row gap-sm mb-4">
                        <span className="text-sm label-w-64">Provider</span>
                        <select
                          className="input"
                          title="GIT Ai provider — used by Source → Generate commit"
                          value={defaults.gitAiProviderId ?? ""}
                          onChange={(e) => void saveDefaults({ ...defaults, gitAiProviderId: e.target.value || null, gitAiModelId: null })}
                        >
                          <option value="">(use chat default)</option>
                          {(catalog?.providers ?? []).filter((p) => p.configured && !p.localOnly).map((p) => (
                            <option key={p.id} value={p.id}>{p.label}</option>
                          ))}
                        </select>
                      </label>
                      {defaults.gitAiProviderId ? (
                        <label className="row gap-sm">
                          <span className="text-sm label-w-64">Model</span>
                          <select
                            className="input"
                            title="GIT Ai model — used by Source → Generate commit"
                            value={defaults.gitAiModelId ?? ""}
                            onChange={(e) => void saveDefaults({ ...defaults, gitAiModelId: e.target.value || null })}
                          >
                            <option value="">(provider default)</option>
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
                  <p className="text-muted">Loading defaults…</p>
                )}

                {/* Profile validation */}
                <div className="mt-12">
                  <h4 className="text-sm text-muted mb-6">Adapter health</h4>
                  {profiles.map((p) => {
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
                  })}
                </div>

                <button
                  className="btn btn-sm"
                  type="button"
                  title="Reset runtime defaults to factory values"
                  onClick={() => void resetRuntimeDefaults().then(() => void refreshDefaults())}
                >
                  <RefreshCw size={12} /> Reset to defaults
                </button>
              </div>
            ) : null}

            {/* ─── Permissions ─── */}
            {tab === "permissions" ? (
              <div className="stack">
                <h3>Permission Rules</h3>
                <p className="text-muted text-sm">Control what agent actions require confirmation. These are local-only.</p>

                {permissions ? (
                  <>
                    <PermissionSelect
                      label="Command execution"
                      title="Permission for running commands outside the chat/terminal process"
                      value={permissions.allowCommandExecution}
                      onChange={(v) => void savePermissions({ ...permissions, allowCommandExecution: v })}
                    />
                    <PermissionSelect
                      label="External file context"
                      title="Permission for reading files outside the active project root"
                      value={permissions.allowExternalContext}
                      onChange={(v) => void savePermissions({ ...permissions, allowExternalContext: v })}
                    />
                    <PermissionSelect
                      label="File modification"
                      title="Permission for modifying files in the active project"
                      value={permissions.allowFileModification}
                      onChange={(v) => void savePermissions({ ...permissions, allowFileModification: v })}
                    />
                  </>
                ) : (
                  <p className="text-muted">Loading permissions…</p>
                )}

                <button
                  className="btn btn-sm"
                  type="button"
                  title="Reset permissions to conservative defaults"
                  onClick={() => void resetPermissionRules().then(() => void refreshPermissions())}
                >
                  <RefreshCw size={12} /> Reset to defaults
                </button>

                {/* Approval Gateway */}
                <div className="stack approval-gateway-section">
                  <h4>Approval Gateway</h4>
                  <p className="text-muted text-sm">
                    Controls how the agent loop handles tool calls that need approval.
                  </p>

                  <div className="row gap-sm">
                    {(["safe", "balanced", "auto"] as ApprovalMode[]).map((m) => (
                      <button
                        key={m}
                        className={`btn btn-sm ${approvalMode === m ? "btn-primary" : ""}`}
                        type="button"
                        title={`Set approval mode to ${m}`}
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
                    {approvalMode === "safe" && "Every tool call prompts for approval. Most secure, most interruptions."}
                    {approvalMode === "balanced" && "Read-only tools auto-allow; mutating tools prompt."}
                    {approvalMode === "auto" && "All tools auto-allow within workspace scoping. Fastest; the default."}
                  </p>

                  {/* Custom rules */}
                  <div className="stack mt-8">
                    <h5>Custom Rules</h5>
                    {approvalRules.length === 0 ? (
                      <p className="text-muted text-sm">No custom rules. Default mode behavior applies.</p>
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
                              title="Remove this rule"
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
                          placeholder="tool name"
                          value={newRuleTool}
                          title="Tool name (e.g. run_command, edit_file)"
                          onChange={(e) => setNewRuleTool(e.target.value)}
                        />
                        <input
                          className="input input-w-140"
                          placeholder="command prefix (optional)"
                          value={newRulePrefix}
                          title="Only apply to commands starting with this prefix"
                          onChange={(e) => setNewRulePrefix(e.target.value)}
                        />
                        <OptionList
                          label="Decision for this rule"
                          value={newRuleDecision}
                          compact
                          onChange={setNewRuleDecision}
                          options={[
                            { id: "ask", label: "Ask", title: "Ask before each action" },
                            { id: "allow", label: "Allow", title: "Allow automatically" },
                            { id: "deny", label: "Deny", title: "Deny automatically" },
                          ]}
                        />
                        <button
                          className="btn btn-sm btn-primary"
                          type="button"
                          title="Add custom approval rule"
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
                          Add Rule
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {/* Audit trail */}
                  <div className="stack mt-12">
                    <div className="row align-center justify-between">
                      <h5>Audit Trail</h5>
                      <button
                        className="btn btn-sm"
                        type="button"
                        title="Clear audit trail"
                        onClick={() => void clearAuditTrail().then(() => void refreshApproval(projectPath))}
                      >
                        <Trash2 size={12} /> Clear
                      </button>
                    </div>
                    {auditTrail.length === 0 ? (
                      <p className="text-muted text-sm">No audit entries yet.</p>
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
                            <span className="text-muted text-xs">{new Date(entry.createdAt * 1000).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
                </div>
              </div>
            ) : null}

            {/* ─── Privacy ─── */}
            {tab === "privacy" ? (
              <div className="stack">
                <h3>Privacy & Analytics</h3>
                <p className="text-muted text-sm">
                  Basebuild is local-first. Analytics are disabled by default and never store prompt text,
                  chat content, source code, terminal output, secrets, or raw file paths.
                </p>

                {consent ? (
                  <>
                    <label className="row gap-sm mt-4">
                      <input
                        type="checkbox"
                        title="Enable local usage analytics — stored on this device only"
                        checked={consent.collectionEnabled}
                        onChange={(e) => void saveConsent({ ...consent, collectionEnabled: e.target.checked })}
                      />
                      <span className="text-sm">Enable local usage analytics</span>
                    </label>
                    <p className="text-muted text-sm mt-n4">
                      Stores privacy-safe metadata (event name, feature area, outcome, duration) on this device only.
                    </p>

                    <label className="row gap-sm mt-4">
                      <input
                        type="checkbox"
                        title="Enable remote upload of anonymous analytics — separate from local collection"
                        checked={consent.uploadEnabled}
                        disabled={!consent.collectionEnabled}
                        onChange={(e) => void saveConsent({ ...consent, uploadEnabled: e.target.checked })}
                      />
                      <span className="text-sm">Enable anonymous upload</span>
                    </label>
                    <p className="text-muted text-sm mt-n4">
                      Upload stays off unless you enable it. Only reviewed, fixed-field endpoints receive supported analytics.
                    </p>

                    <div className="mt-8">
                      <h4 className="text-sm text-muted mb-6">Local analytics data</h4>
                      <div className="row gap-sm">
                        <span className="text-sm mono">{eventCount} events stored</span>
                        <button
                          className="btn btn-sm"
                          type="button"
                          title="Export local analytics data as JSON"
                          onClick={() => void exportAnalytics()}
                          disabled={eventCount === 0}
                        >
                          <Download size={12} /> Export
                        </button>
                        <button
                          className="btn btn-sm"
                          type="button"
                          title="Delete all local analytics events"
                          onClick={() => void deleteAnalytics()}
                          disabled={eventCount === 0}
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    </div>

                    <div className="mt-8">
                      <h4 className="text-sm text-muted mb-6">Execution recommendation feedback</h4>
                      <label className="row gap-sm">
                        <input
                          type="checkbox"
                          title="Separately opt in to fixed-field execution recommendation feedback"
                          checked={advisorFeedbackConsent?.enabled ?? false}
                          disabled={!consent.collectionEnabled || !advisorFeedbackConsent}
                          onChange={(event) => void saveAdvisorFeedbackConsent(event.target.checked)}
                        />
                        <span className="text-sm">Collect recommendation choices</span>
                      </label>
                      <p className="text-muted text-sm mt-n4">
                        Off by default. Stores only model/provider ids, role, fixed estimate buckets,
                        confidence, and accepted/overridden outcome. No free text, project content, paths,
                        account ids, credentials, or raw usage.
                      </p>
                      <p className="text-muted text-sm">
                        Remote upload additionally requires anonymous upload above; queued choices remain local until both gates are enabled.
                      </p>
                      <div className="row gap-sm">
                        <span className="text-sm mono">{advisorFeedbackCount} choices stored</span>
                        <button
                          className="btn btn-sm"
                          type="button"
                          title="Inspect execution recommendation feedback by exporting its fixed-field JSON"
                          onClick={() => void exportAdvisorFeedback()}
                          disabled={advisorFeedbackCount === 0}
                        >
                          <Download size={12} /> Export
                        </button>
                        <button
                          className="btn btn-sm"
                          type="button"
                          title="Delete all local execution recommendation feedback"
                          onClick={() => void deleteAdvisorFeedback()}
                          disabled={advisorFeedbackCount === 0}
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-muted">Loading analytics consent…</p>
                )}

                {consent && !consent.collectionEnabled ? (
                  <div className="requirement-row is-ok mt-8">
                    <span className="requirement-badge is-ok">✓</span>
                    <div>
                      <div className="requirement-name">Analytics disabled</div>
                      <div className="text-muted text-sm">No data leaves this device.</div>
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
                  <h3>MCP Servers</h3>
                  <button
                    className="btn btn-sm"
                    type="button"
                    title="Reload MCP server configs from disk"
                    disabled={mcpLoading || !projectPath}
                    onClick={() => void refreshMcp()}
                  >
                    <RefreshCw size={14} />
                    Reload
                  </button>
                </div>
                <p className="text-muted text-sm">
                  MCP servers are defined in <code>.omp/mcp.json</code> (project) or <code>~/.omp/agent/mcp.json</code> (user). Configure once — shared with oh-my-pi.
                </p>
                {mcpErrors.length > 0 ? (
                  <div className="callout callout-warn">
                    {mcpErrors.map((e, i) => (
                      <div key={i}>{e}</div>
                    ))}
                  </div>
                ) : null}
                {mcpServers.length === 0 ? (
                  <p className="text-muted text-sm">No MCP servers configured.</p>
                ) : (
                  <div className="stack">
                    {mcpServers.map((s) => (
                      <div key={s.name} className="settings-row">
                        <div className="settings-row-info">
                          <div className="settings-row-label">{s.name}</div>
                          <div className="text-muted text-sm">
                            {s.source} · {s.state}
                            {s.toolCount > 0 ? ` · ${s.toolCount} tools` : ""}
                            {s.promptCount > 0 ? ` · ${s.promptCount} prompts` : ""}
                            {s.error ? ` · ${s.error}` : ""}
                          </div>
                        </div>
                        <div className="settings-row-actions">
                          {s.state === "connected" ? (
                            <button
                              className="btn btn-sm"
                              type="button"
                              title="Disconnect this server"
                              disabled={!projectPath}
                              onClick={() => {
                                if (!projectPath) return;
                                void mcpDisconnect(projectPath, s.name).then(() => refreshMcp());
                              }}
                            >
                              <Unplug size={14} />
                              Disconnect
                            </button>
                          ) : (
                            <button
                              className="btn btn-sm"
                              type="button"
                              title="Reconnect this server"
                              disabled={mcpLoading || !projectPath}
                              onClick={() => void refreshMcp()}
                            >
                              <RefreshCw size={14} />
                              Connect
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
                <UsageSyncPanel />
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
                <h3>Basebuild</h3>
                <p className="text-muted">Version {version || "…"}</p>
                <p className="text-muted text-sm">
                  Desktop application for managing OMP terminals, source control,
                  ideas, and plans.
                </p>
                <div className="stack-sm mt-8">
                  <a className="text-sm" href="https://basebuild.net" target="_blank" rel="noopener noreferrer" title="Visit basebuild.net">basebuild.net</a>
                  <a className="text-sm" href="https://github.com/basebuild-net/basebuild" target="_blank" rel="noopener noreferrer" title="Visit GitHub repository">github.com/basebuild-net/basebuild</a>
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
          { id: "ask", label: "Ask before each action", title: "Ask before each action" },
          { id: "allow", label: "Allow automatically", title: "Allow automatically" },
          { id: "deny", label: "Deny automatically", title: "Deny automatically" },
        ]}
      />
    </label>
  );
}