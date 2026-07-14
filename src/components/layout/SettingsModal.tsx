import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Bell, Check, Download, Globe, Key, Lightbulb, Lock, LogOut, Moon, Plug, RefreshCw, Settings2, Shield, Sparkles, Sun, Trash2, Unplug, User, Wrench, X } from "lucide-react";
import { ConfigPanel } from "../panels/ConfigPanel";
import { CopyButton } from "./CopyButton";
import { FinalTouchesTab } from "./FinalTouchesTab";
import { OpenSpecSettingsTab } from "./OpenSpecSettingsTab";
import { PlanningTab } from "./PlanningTab";
import { OptionList } from "./OptionList";
import { RuntimeDefaultsFields } from "./RuntimeDefaultsFields";
import { listRequirements, type RequirementStatus } from "../../lib/requirements";
import { appVersion } from "../../lib/app";
import type { UpdaterState } from "../../state/updater";
import { authStartDeviceFlow, authPollDeviceFlow, type PollResult } from "../../lib/auth";
import { useAccount, type AccountState } from "../../state/account";
import { useUsageSync } from "../../state/usageSync";
import {
  usageDetectProviderPlans,
  usageListProviderPlans,
  usageDeclareProviderPlans,
} from "../../lib/usageSync";
import type { DetectedProviderPlan, ProviderPlanOption } from "../../lib/usageSync";
import {
  nativeProviderCatalog,
  nativeProviderLoginStart,
  nativeProviderLoginPoll,
  nativeProviderLoginCancel,
  nativeSaveProviderCredential,
  nativeDeleteProviderCredential,
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
  notificationGetSettings,
  notificationSetSettings,
  type NotificationSettings as NotificationSettingsType,
  type NotificationDelivery,
} from "../../lib/notifications";
 import {
  getAnalyticsConsent,
  setAnalyticsConsent,
  analyticsEventCount,
  deleteAnalyticsEvents,
  exportAnalyticsJson,
  type AnalyticsConsent,
} from "../../lib/analytics";
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
import {
  getRunConcurrencyDefaults,
  setRunConcurrencyDefaults,
  getRunConcurrencyOverrides,
  setRunConcurrencyOverride,
  DEFAULT_RUN_CONCURRENCY_ENTRY,
  type RunConcurrencyEntry,
} from "../../lib/runConcurrency";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { listResolvedSkills, readResolvedSkill, type ResolvedSkill } from "../../lib/skillRegistry";
import { useTheme, type AppTheme } from "../../state/useTheme";
import { ModalPortal } from "../ModalPortal";

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
  projectPath: string | null;
  account: AccountState;
  updates: UpdaterState;
};

type Tab = "updates" | "defaults" | "permissions" | "privacy" | "theme" | "account" | "configs" | "mcp" | "planning" | "openspec" | "final_touches" | "concurrency" | "notifications" | "skills" | "about";

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
      const [c, count] = await Promise.all([getAnalyticsConsent(), analyticsEventCount()]);
      setConsent(c);
      setEventCount(count);
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

  const chatProfiles = profiles.filter((p) => p.kind === "chat");
  const terminalProfiles = profiles.filter((p) => p.kind === "terminal");

  if (!open) return null;

  const tabs: { id: Tab; label: string; icon: typeof Settings2 }[] = [
    { id: "updates", label: "Updates", icon: RefreshCw },
    { id: "defaults", label: "Defaults", icon: Settings2 },
    { id: "permissions", label: "Permissions", icon: Lock },
    { id: "privacy", label: "Privacy", icon: Shield },
    { id: "theme", label: "Theme", icon: Sun },
    { id: "account", label: "Account", icon: User },
    { id: "configs", label: "Config Packs", icon: Settings2 },
    { id: "mcp", label: "MCP Servers", icon: Plug },
    { id: "planning", label: "Planning", icon: Lightbulb },
    { id: "openspec", label: "OpenSpec", icon: Wrench },
    { id: "final_touches", label: "Final Touches", icon: Settings2 },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "concurrency", label: "Concurrency", icon: Settings2 },
    { id: "skills", label: "Skills", icon: Sparkles },
    { id: "about", label: "About", icon: Globe },
  ];

  const updateChecking = updates.status === "checking";
  const updateInstalling = updates.status === "installing";
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
            {tabs.map((t) => {
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
                    disabled={updateChecking || updateInstalling}
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
                      <button
                        className="btn btn-update btn-sm update-action-row"
                        type="button"
                        title="Download and install this update"
                        onClick={() => void updates.install()}
                        disabled={updateInstalling}
                      >
                        <Download size={12} /> {updateInstalling ? "Installing…" : "One-click update"}
                      </button>
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
                      Upload is disabled until a reviewed endpoint is configured. No upload code runs unless this is enabled.
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

            {/* ─── Theme ─── */}
            {tab === "theme" ? <ThemeTab /> : null}

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
                <UsageSyncPanel signedIn={!!account.profile} />
                <ModelProvidersPanel />
              </div>
            ) : null}

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


function AccountPanel({ account }: { account: AccountState }) {
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  async function signIn() {
    setError(null);
    setPolling(true);
    try {
      const result = await authStartDeviceFlow({
        clientName: "Basebuild Desktop",
        platform: navigator.platform,
      });
      setDeviceCode(result.deviceCode);

      // Poll until success, denial, or expiry
      const tick = async () => {
        try {
          const pollResult = await authPollDeviceFlow(result.deviceCode);
          if (pollResult.status === "pending") {
            setTimeout(() => void tick(), (pollResult.interval + 1) * 1000);
          } else if (pollResult.status === "success") {
            await account.refresh();
            setPolling(false);
            setDeviceCode(null);
          } else if (pollResult.status === "denied") {
            setError("Sign-in was denied.");
            setPolling(false);
            setDeviceCode(null);
          } else {
            setError("The sign-in code expired. Please try again.");
            setPolling(false);
            setDeviceCode(null);
          }
        } catch (e) {
          setError(String(e));
          setPolling(false);
          setDeviceCode(null);
        }
      };
      setTimeout(() => void tick(), (result.interval + 1) * 1000);
    } catch (e) {
      setError(String(e));
      setPolling(false);
    }
  }


  if (account.loading) {
    return <p className="text-muted">Loading account…</p>;
  }

  if (account.profile) {
    return (
      <div className="stack">
        <h3>Account</h3>
        <div className="row gap-sm account-profile-row">
          {account.profile.image && !imgFailed ? (
            <img
              src={account.profile.image}
              alt={account.profile.username}
              className="account-avatar"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <span className="account-avatar account-avatar-placeholder">
              {account.profile.username.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div>
            <div className="text-sm">{account.profile.username}</div>
            <div className="text-muted text-sm">{account.profile.email}</div>
          </div>
        </div>
        <button
          className="btn btn-sm"
          type="button"
          title="Sign out and revoke this device's token"
          onClick={() => void account.signOut()}
        >
          <LogOut size={12} /> Sign out
        </button>
        {error ? <p className="text-danger text-sm">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="stack">
      <h3>Account</h3>
      <p className="text-muted text-sm">
        Sign in with your basebuild.net account to sync usage through MCP
        without creating an API key. The app works as a guest without signing in.
      </p>
      {polling ? (
        <p className="text-muted text-sm">Waiting for browser approval… Check your browser to approve the sign-in.</p>
      ) : (
        <button
          className="btn btn-primary"
          type="button"
          title="Open browser to sign in to basebuild.net"
          onClick={() => void signIn()}
        >
          <User size={12} /> Sign in
        </button>
      )}
      {error ? <p className="text-danger text-sm">{error}</p> : null}
    </div>
  );
}

function UsageSyncPanel({ signedIn }: { signedIn: boolean }) {
  const { status, projected, loading, error, lastSyncResult, fetchProjected, triggerSync, setEnabled, setMode } =
    useUsageSync(signedIn);
  const [toggling, setToggling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [savingMode, setSavingMode] = useState(false);

  if (!signedIn) {
    return (
      <div className="stack">
        <h3>Usage Sync</h3>
        <p className="text-muted text-sm">
          Sign in to sync your OMP usage to basebuild.net and see projected provider usage here.
        </p>
      </div>
    );
  }

  async function toggleAutoSync(enabled: boolean) {
    setToggling(true);
    try {
      await setEnabled(enabled);
    } finally {
      setToggling(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      await triggerSync("manual");
      await fetchProjected();
    } finally {
      setSyncing(false);
    }
  }

  async function changeMode(mode: "rows" | "summary") {
    setSavingMode(true);
    try {
      await setMode(mode);
    } finally {
      setSavingMode(false);
    }
  }

  const liveRows = projected?.live.rows ?? [];
  const snapshotRows = projected?.snapshot.rows ?? [];

  return (
    <div className="stack">
      <h3>Usage Sync</h3>
      <p className="text-muted text-sm">
        Sync your usage to basebuild.net so your dashboard shows what provider, model, and
        subscription each message used. The app sends only aggregated usage stats (model,
        provider, subscription tier, tokens, cost, timing) — never prompts, source code, or secrets.
      </p>
      {status && !status.gatesPass ? (
        <p className="text-danger text-sm" title="Usage upload is currently off">
          Syncing is paused — turn on &quot;Enable anonymous upload&quot; in Settings → Privacy to allow usage upload. Until then, Auto-sync and Sync now do nothing.
        </p>
      ) : null}

      <div className="row gap-sm flex-wrap">
        <label className="row gap-sm">
          <input
            type="checkbox"
            checked={status?.enabled ?? false}
            disabled={toggling}
            onChange={(e) => void toggleAutoSync(e.target.checked)}
            title="Enable hourly auto-sync to basebuild.net"
          />
          <span className="text-sm">Auto-sync every {status?.intervalMinutes ?? 60} min</span>
        </label>
        <button
          className="btn btn-sm"
          type="button"
          title="Sync usage now"
          disabled={syncing}
          onClick={() => void syncNow()}
        >
          <RefreshCw size={12} /> Sync now
        </button>
        {status?.lastSyncAt ? (
          <span className="text-muted text-sm">
            Last sync: {new Date((status.lastSyncAt ?? 0) * 1000).toLocaleString()}
          </span>
        ) : null}
      </div>

      <div className="row gap-sm flex-wrap">
        <label className="text-sm" htmlFor="usage-sync-mode">Detail level</label>
        <select
          id="usage-sync-mode"
          className="input input-sm"
          value={status?.syncMode === "summary" ? "summary" : "rows"}
          disabled={savingMode}
          onChange={(e) => void changeMode(e.target.value === "summary" ? "summary" : "rows")}
          title="How much usage detail the app sends to basebuild.net"
        >
          <option value="rows">Full message rows — server rolls up (recommended)</option>
          <option value="summary">Client summaries — lighter, less detail</option>
        </select>
      </div>

      {status?.lastError ? (
        <p className="text-danger text-sm" title={status.lastError}>
          Last error: {status.lastError}
        </p>
      ) : null}
      {lastSyncResult ? (
        <p className={`text-sm ${lastSyncResult.ok ? "text-muted" : "text-danger"}`} title={lastSyncResult.message}>
          {lastSyncResult.ok ? "✓ " : "✗ "}
          {lastSyncResult.message}
        </p>
      ) : null}
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      {loading ? <p className="text-muted text-sm">Loading…</p> : null}

      {liveRows.length > 0 ? (
        <div className="card">
          <h4>Live Utilization</h4>
          {liveRows.map((r) => {
            const pct = Math.round(r.usedFraction * 100);
            return (
              <div
                key={`${r.provider}-${r.window}`}
                className={`usage-window-row ${r.isStale ? "is-stale" : ""}`}
                title={`${r.provider} ${r.window}: ${pct}% used${r.resetsAt ? ` · resets ${r.resetsAt}` : ""}${r.isStale ? " · stale" : ""}`}
              >
                <span className="text-sm">{r.provider} · {r.window}</span>
                <div className="usage-window-bar">
                  <div className="usage-window-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-sm">{pct}%</span>
                {r.isStale ? <span className="text-muted text-sm">stale</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {snapshotRows.length > 0 ? (
        <div className="card">
          <h4>Per-Model Usage (last 7 days)</h4>
          <table className="usage-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model</th>
                <th>Req/day</th>
                <th>Hrs/day</th>
                <th>$/day</th>
              </tr>
            </thead>
            <tbody>
              {snapshotRows.map((r) => (
                <tr key={`${r.provider}-${r.model}`}>
                  <td>{r.provider}</td>
                  <td>{r.model}</td>
                  <td>{Math.round(r.requestsPerDay)}</td>
                  <td>{r.hoursPerDay.toFixed(1)}</td>
                  <td>{r.costPerDay != null ? `$${r.costPerDay.toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ProviderPlansPanel gatesPass={status?.gatesPass ?? false} />
    </div>
  );
}

function ProviderPlansPanel({ gatesPass }: { gatesPass: boolean }) {
  const [detected, setDetected] = useState<DetectedProviderPlan[]>([]);
  const [catalog, setCatalog] = useState<Map<string, ProviderPlanOption[]>>(new Map());
  const [selections, setSelections] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, c] = await Promise.all([usageDetectProviderPlans(), usageListProviderPlans()]);
      setDetected(d);
      const byProvider = new Map<string, ProviderPlanOption[]>();
      for (const opt of c) {
        const arr = byProvider.get(opt.provider) ?? [];
        arr.push(opt);
        byProvider.set(opt.provider, arr);
      }
      setCatalog(byProvider);
      // Pre-select volume-inferred plans (match the inferred plan name to a
      // catalog option) so the user can confirm the prediction with one click.
      const seeded = new Map<string, string>();
      for (const dp of d) {
        if (!dp.needsDeclaration || !dp.detectedPlanType) continue;
        const match = (byProvider.get(dp.provider) ?? []).find(
          (o) => o.name.toLowerCase() === dp.detectedPlanType!.toLowerCase(),
        );
        if (match) seeded.set(dp.provider, match.id);
      }
      if (seeded.size > 0) setSelections(seeded);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function pickPlan(provider: string, planId: string) {
    setSelections((prev) => {
      const next = new Map(prev);
      if (planId) {
        next.set(provider, planId);
      } else {
        next.delete(provider);
      }
      return next;
    });
  }

  async function savePlans() {
    if (selections.size === 0) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const plans: Record<string, string> = {};
      for (const [provider, planId] of selections) {
        plans[provider] = planId;
      }
      const msg = await usageDeclareProviderPlans(plans);
      setMessage(msg);
      setSelections(new Map());
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (detected.length === 0 && !loading) return null;

  return (
    <div className="card">
      <h4>Provider Plans</h4>
      <p className="text-muted text-sm">
        Detected natively from your provider credentials. Providers we can&apos;t detect (their API
        doesn&apos;t expose the plan) show a picker — declaring your exact plan gives basebuild.net a
        100%-confidence attribution instead of a guess.
      </p>
      {!gatesPass ? (
        <p className="text-muted text-sm">
          Enable usage upload in Settings → Privacy to sync declared plans.
        </p>
      ) : null}
      {loading ? <p className="text-muted text-sm">Detecting…</p> : null}
      {detected.map((d) => {
        const options = catalog.get(d.provider) ?? [];
        return (
          <div key={d.provider} className="stack gap-xs">
            <div className="usage-plan-row row gap-sm flex-wrap" title={`${d.provider}: ${d.source}`}>
              <span className="text-sm usage-plan-provider">{d.provider}</span>
              {d.needsDeclaration ? (
                <select
                  className="input input-sm"
                  value={selections.get(d.provider) ?? ""}
                  disabled={saving || options.length === 0}
                  onChange={(e) => pickPlan(d.provider, e.target.value)}
                  title={`Declare your ${d.provider} plan`}
                >
                  <option value="">
                    {options.length === 0 ? "No catalog plans" : "Select your plan…"}
                  </option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <span className="text-sm" title={`Detected via ${d.source}`}>
                  ✓ {d.detectedPlanType ?? "detected"}
                  <span className="text-muted"> · {d.source === "native" ? "native credential" : d.source}</span>
                </span>
              )}
              {d.confidence === "inferred" ? (
                <span className="text-muted text-sm" title="Predicted from usage volume, not provider-confirmed">
                  inferred
                </span>
              ) : null}
            </div>
            {d.note ? <p className="text-muted text-sm">{d.note}</p> : null}
          </div>
        );
      })}
      {selections.size > 0 ? (
        <button
          className="btn btn-sm"
          type="button"
          disabled={saving || !gatesPass}
          onClick={() => void savePlans()}
          title="Save declared plans to basebuild.net"
        >
          {saving ? "Saving…" : `Save ${selections.size} plan${selections.size === 1 ? "" : "s"}`}
        </button>
      ) : null}
      {message ? <p className="text-muted text-sm">✓ {message}</p> : null}
      {error ? <p className="text-danger text-sm">{error}</p> : null}
    </div>
  );
}

function ModelProvidersPanel() {
  const [catalog, setCatalog] = useState<NativeProviderCatalog | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [baseUrlDrafts, setBaseUrlDrafts] = useState<Record<string, string>>({});
  const [updateKeyId, setUpdateKeyId] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const refresh = useCallback(async () => {
    try {
      setCatalog(await nativeProviderCatalog());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [refresh]);

  const connectWeb = useCallback(
    async (providerId: string) => {
      setError(null);
      setBusyId(providerId);
      const poll = async () => {
        try {
          const res = await nativeProviderLoginPoll(providerId);
          if (res.status === "pending") {
            pollRef.current = window.setTimeout(() => void poll(), 1500);
          } else if (res.status === "success") {
            setBusyId(null);
            await refresh();
          } else {
            setError(res.message ?? "Provider login did not complete.");
            setBusyId(null);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setBusyId(null);
        }
      };
      try {
        await nativeProviderLoginStart(providerId);
        pollRef.current = window.setTimeout(() => void poll(), 1500);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setBusyId(null);
      }
    },
    [refresh],
  );

  const cancelWeb = useCallback((providerId: string) => {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    void nativeProviderLoginCancel(providerId);
    setBusyId(null);
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
        // Clear drafts only after a successful save so a failure keeps input.
        setKeyDrafts((prev) => ({ ...prev, [providerId]: "" }));
        setUpdateKeyId(null);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [keyDrafts, baseUrlDrafts, refresh],
  );

  const disconnect = useCallback(
    async (providerId: string) => {
      setBusyId(providerId);
      setError(null);
      try {
        await nativeDeleteProviderCredential(providerId);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const providers = (catalog?.providers ?? []).filter((p) => !p.localOnly);

  return (
    <div className="stack mt-16">
      <h3>Model Providers</h3>
      <p className="text-muted text-sm">
        Connect model providers with a web flow or an API key. Credentials are stored locally on this device only.
      </p>
      <button
        className="btn btn-sm"
        type="button"
        title="Refresh model catalog from all configured providers"
        disabled={busyId === "refresh"}
        onClick={async () => { setBusyId("refresh"); await refresh(); setBusyId(null); }}
      >
        <RefreshCw size={12} /> Refresh models
      </button>
      {providers.map((p) => (
        <div key={p.id} className="requirement-row items-start">
          <span className={`requirement-badge is-${p.configured ? "ok" : "attention"}`}>
            {p.configured ? "✓" : "!"}
          </span>
          <div className="flex-1">
            <div className="requirement-name">
              {p.label} {p.configured ? <span className="text-muted text-sm">connected</span> : null}{p.modelCount > 0 ? <span className="text-muted text-sm"> · {p.modelCount} model{p.modelCount === 1 ? "" : "s"}</span> : null}
            </div>
            {p.apiKeyUrl && !p.configured ? (
              <a href={p.apiKeyUrl} target="_blank" rel="noopener noreferrer" className="text-muted text-sm" title={`Get an API key from ${p.label}`}>
                Get API key →
              </a>
            ) : null}
            {p.configured ? (
              <div className="stack-sm mt-6">
                <div className="row gap-sm">
                  <button
                    className="btn btn-sm"
                    type="button"
                    title={`Disconnect ${p.label}`}
                    disabled={busyId === p.id}
                    onClick={() => void disconnect(p.id)}
                  >
                    <Unplug size={12} /> Disconnect
                  </button>
                  <button
                    className="btn btn-sm"
                    type="button"
                    title={`Update the API key for ${p.label}. The stored secret is never displayed.`}
                    disabled={busyId === p.id}
                    onClick={() => setUpdateKeyId(updateKeyId === p.id ? null : p.id)}
                  >
                    <Key size={12} /> Update key
                  </button>
                </div>
                {updateKeyId === p.id ? (
                  <div className="stack-sm">
                    <div className="row gap-sm">
                      <input
                        className="input"
                        type="password"
                        placeholder="New API key"
                        value={keyDrafts[p.id] ?? ""}
                        onChange={(e) => setKeyDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        title={`Enter a new API key for ${p.label}. The existing key is not shown.`}
                      />
                      <button
                        className="btn btn-sm"
                        type="button"
                        title="Save the new API key"
                        disabled={!(keyDrafts[p.id] ?? "").trim()}
                        onClick={() => void saveKey(p.id, p.label)}
                      >
                        <Key size={12} /> Save
                      </button>
                      <button
                        className="btn btn-sm"
                        type="button"
                        title="Cancel key update"
                        onClick={() => { setUpdateKeyId(null); setKeyDrafts((prev) => ({ ...prev, [p.id]: "" })); }}
                      >
                        Cancel
                      </button>
                    </div>
                    {p.id === "custom" ? (
                      <input
                        className="input"
                        type="text"
                        placeholder="Base URL (e.g. https://api.example.com/v1)"
                        value={baseUrlDrafts[p.id] ?? ""}
                        onChange={(e) => setBaseUrlDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        title="Base URL for the custom OpenAI-compatible endpoint"
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : busyId === p.id ? (
              <div className="row gap-sm mt-6">
                <span className="text-muted text-sm">Waiting for browser…</span>
                <button className="btn btn-sm" type="button" title="Cancel" onClick={() => cancelWeb(p.id)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="stack-sm mt-6">
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  title={`Connect with ${p.label}`}
                  onClick={() => void connectWeb(p.id)}
                >
                  <Globe size={12} /> Connect with {p.label}
                </button>
                <div className="row gap-sm">
                  <input
                    className="input"
                    type="password"
                    placeholder="or paste API key"
                    value={keyDrafts[p.id] ?? ""}
                    onChange={(e) => setKeyDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    title={`API key for ${p.label}`}
                  />
                  <button
                    className="btn btn-sm"
                    type="button"
                    title="Save API key"
                    disabled={!(keyDrafts[p.id] ?? "").trim()}
                    onClick={() => void saveKey(p.id, p.label)}
                  >
                    <Key size={12} /> Save
                  </button>
                </div>
                {p.id === "custom" ? (
                  <input
                    className="input"
                    type="text"
                    placeholder="Base URL (e.g. https://api.example.com/v1)"
                    value={baseUrlDrafts[p.id] ?? ""}
                    onChange={(e) => setBaseUrlDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    title="Base URL for the custom OpenAI-compatible endpoint"
                  />
                ) : null}
              </div>
            )}
          </div>
        </div>
      ))}
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      {catalog?.providers.some((p) => p.error && !p.localOnly) ? (
        <div className="stack-sm">
          {catalog.providers.filter((p) => p.error && !p.localOnly).map((p) => (
            <p key={p.id} className="text-danger text-sm" title={p.error ?? ""}>
              {p.label}: {p.error}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ConcurrencyTab({ projectPath }: { projectPath: string | null }) {
  const projectPathNonNull = projectPath ?? "";
  const [globalLimits, setGlobalLimits] = useState<Record<string, RunConcurrencyEntry>>({});
  const [projectLimits, setProjectLimits] = useState<Record<string, RunConcurrencyEntry>>({});
  const [providers, setProviders] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [global, project, catalog] = await Promise.all([
          getRunConcurrencyDefaults(),
          getRunConcurrencyOverrides(projectPathNonNull),
          nativeProviderCatalog(),
        ]);
        if (cancelled) return;
        setGlobalLimits(global.providers);
        setProjectLimits(project.providers);
        setProviders(catalog.providers.map((p) => ({ id: p.id, label: p.label })));
      } catch {
        // ignore — empty state shows
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [projectPathNonNull]);

  async function saveProvider(providerId: string, entry: RunConcurrencyEntry, isProject: boolean) {
    setSaving(providerId);
    try {
      if (isProject) {
        await setRunConcurrencyOverride(projectPathNonNull, providerId, entry);
        setProjectLimits((prev) => ({ ...prev, [providerId]: entry }));
      } else {
        const next = { ...globalLimits, [providerId]: entry };
        await setRunConcurrencyDefaults({ providers: next });
        setGlobalLimits(next);
      }
    } catch {
      // ignore
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="stack">
        <h3>Run Concurrency</h3>
        <p className="text-muted text-sm">Loading…</p>
      </div>
    );
  }

  const allProviders = providers.length > 0
    ? providers
    : [{ id: "basebuild-local", label: "None" }, { id: "basebuild-native", label: "Basebuild Native" }];

  return (
    <div className="stack">
      <h3>Run Concurrency</h3>
      <p className="text-muted text-sm">
        Per-provider max concurrency for plan runs + subagents. Default is 1 (most providers meter concurrency).
        Project overrides take precedence over global defaults. Subagents are off by default.
      </p>
      <div className="settings-table">
        <div className="settings-table-header">
          <span>Provider</span>
          <span>Global max</span>
          <span>Project max</span>
          <span>Subagents</span>
          <span>Subagent cap</span>
        </div>
        {allProviders.map((p) => {
          const global = globalLimits[p.id] ?? DEFAULT_RUN_CONCURRENCY_ENTRY;
          const project = projectLimits[p.id] ?? null;
          const effective = project ?? global;
          return (
            <div key={p.id} className="settings-table-row">
              <span title={p.id}>{p.label}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={16}
                title={`Global max concurrency for ${p.label} (default 1)`}
                value={global.maxConcurrency}
                disabled={saving === p.id}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(16, Number(e.target.value) || 1));
                  void saveProvider(p.id, { ...global, maxConcurrency: v }, false);
                }}
              />
              <input
                className="input"
                type="number"
                min={0}
                max={16}
                title={`Project override for ${p.label} (empty = use global; set 0 to disable)`}
                value={project?.maxConcurrency ?? ""}
                placeholder={String(global.maxConcurrency)}
                disabled={saving === p.id}
                onChange={(e) => {
                  const v = e.target.value === "" ? 0 : Math.max(0, Math.min(16, Number(e.target.value) || 0));
                  void saveProvider(p.id, { ...effective, maxConcurrency: v || global.maxConcurrency }, true);
                }}
              />
              <label className="settings-checkbox" title={`Enable subagents for ${p.label}`}>
                <input
                  type="checkbox"
                  checked={effective.subagentsEnabled}
                  onChange={(e) => {
                    const next = { ...effective, subagentsEnabled: e.target.checked };
                    void saveProvider(p.id, next, !!project || e.target.checked);
                  }}
                />
                <span className="text-sm">{effective.subagentsEnabled ? "on" : "off"}</span>
              </label>
              <input
                className="input"
                type="number"
                min={0}
                max={8}
                title={`Max concurrent subagents for ${p.label} (counted against the provider limit)`}
                value={effective.subagentMaxCount}
                disabled={!effective.subagentsEnabled || saving === p.id}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(8, Number(e.target.value) || 0));
                  void saveProvider(p.id, { ...effective, subagentMaxCount: v }, !!project);
                }}
              />
            </div>
          );
        })}
      </div>
      <p className="text-muted text-sm" title="Effective value = project override else global default">
        Effective value shown at the point of use when a run is queued.
      </p>
    </div>
  );
}

const NOTIFICATION_KIND_LABELS: { kind: string; label: string; defaultDelivery: NotificationDelivery }[] = [
  { kind: "run_finished", label: "Run finished", defaultDelivery: "toast_and_center" },
  { kind: "run_failed", label: "Run failed", defaultDelivery: "toast_and_center" },
  { kind: "run_started", label: "Run started", defaultDelivery: "toast_and_center" },
  { kind: "plan_created", label: "Plan created", defaultDelivery: "toast_and_center" },
  { kind: "plan_status_changed", label: "Plan status changed", defaultDelivery: "toast_and_center" },
  { kind: "pending_question", label: "Pending question", defaultDelivery: "toast_and_center" },
  { kind: "integration_action", label: "Integration results", defaultDelivery: "toast_and_center" },
  { kind: "schematic_drift_suspected", label: "Schematic drift", defaultDelivery: "toast_and_center" },
  { kind: "stage_succeeded", label: "Stage succeeded", defaultDelivery: "toast_and_center" },
  { kind: "stage_failed", label: "Stage failed", defaultDelivery: "toast_and_center" },
  { kind: "idea_status_changed", label: "Idea status changed", defaultDelivery: "center_only" },
  { kind: "category_created", label: "Category created", defaultDelivery: "center_only" },
  { kind: "schematic_updated", label: "Schematic updated", defaultDelivery: "center_only" },
  { kind: "stage_started", label: "Stage started", defaultDelivery: "center_only" },
  { kind: "stage_cancelled", label: "Stage cancelled", defaultDelivery: "center_only" },
];

const DELIVERY_LABELS: { id: NotificationDelivery; label: string; title: string }[] = [
  { id: "toast_and_center", label: "Toast + Center", title: "Toast + Center" },
  { id: "center_only", label: "Center only", title: "Center only" },
  { id: "off", label: "Off", title: "Off" },
];

function NotificationsTab() {
  const [settings, setSettings] = useState<NotificationSettingsType | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    void notificationGetSettings().then(setSettings).catch(() => {});
  }, []);

  const effective = (kind: string, defaultDelivery: NotificationDelivery): NotificationDelivery =>
    (settings?.overrides[kind] as NotificationDelivery | undefined) ?? defaultDelivery;
  const save = useCallback(async (kind: string, delivery: NotificationDelivery, defaultDelivery: NotificationDelivery) => {
    if (!settings) return;
    setSaving(kind);
    try {
      const newOverrides = { ...settings.overrides };
      if (delivery === defaultDelivery) {
        delete newOverrides[kind];
      } else {
        newOverrides[kind] = delivery;
      }
      const updated = { overrides: newOverrides };
      await notificationSetSettings(updated);
      setSettings(updated);
    } catch {
      // ignore
    } finally {
      setSaving(null);
    }
  }, [settings]);

  if (!settings) {
    return <p className="text-muted text-sm">Loading notification settings…</p>;
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Notification delivery</h3>
      <p className="text-muted text-sm" title="Per-kind delivery: toast + center, center only, or off. Changes apply immediately.">
        Control where each event type surfaces. Defaults are conservative (high-signal events toast + center; idea/category events center only).
      </p>
      <div className="settings-list">
        {NOTIFICATION_KIND_LABELS.map(({ kind, label, defaultDelivery }) => (
          <div key={kind} className="settings-row">
            <span className="settings-label" title={`Default: ${defaultDelivery}`}>{label}</span>
            <OptionList
              label={`Delivery for ${label}`}
              value={effective(kind, defaultDelivery)}
              compact
              disabled={saving === kind}
              onChange={(v) => void save(kind, v, defaultDelivery)}
              options={DELIVERY_LABELS}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillsTab() {
  const [skills, setSkills] = useState<ResolvedSkill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewSkill, setPreviewSkill] = useState<ResolvedSkill | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await listResolvedSkills();
        setSkills(list);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load skills");
      }
    })();
  }, []);

  useEffect(() => {
    if (!previewSkill) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPreviewSkill(null);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [previewSkill]);

  async function openPreview(skill: ResolvedSkill) {
    setPreviewSkill(skill);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewContent(null);
    try {
      const content = await readResolvedSkill(skill.name);
      setPreviewContent(content);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Failed to load skill content");
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <div className="stack">
      <h3>Skills</h3>
      <p className="text-muted text-sm">Resolved skills available to the agent loop.</p>
      {error ? (
        <p className="text-danger text-sm">{error}</p>
      ) : skills === null ? (
        <p className="text-muted text-sm">Loading skills…</p>
      ) : skills.length === 0 ? (
        <p className="text-muted text-sm">No skills resolved. Bundled skills provision on first run.</p>
      ) : (
        <div className="skills-list">
          {skills.map((skill) => (
            <div key={skill.name} className="skill-row">
              <div className="skill-row-name" title={skill.path}>{skill.name}</div>
              <div className="skill-row-desc">{skill.description}</div>
              <span className={`skill-badge skill-badge-${skill.source}`}>{skill.source}</span>
              <span className="skill-badge">{skill.runtime}</span>
              <button
                className="btn btn-sm"
                type="button"
                title="Preview skill content"
                onClick={() => void openPreview(skill)}
              >
                View
              </button>
            </div>
          ))}
        </div>
      )}

      {previewSkill ? (
        <ModalPortal>
        <div className="modal-overlay" onClick={() => setPreviewSkill(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{previewSkill.name}</h3>
              <button
                className="btn-icon"
                type="button"
                title="Close preview"
                onClick={() => setPreviewSkill(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              {previewLoading ? (
                <p className="text-muted text-sm">Loading…</p>
              ) : previewError ? (
                <p className="text-danger text-sm">{previewError}</p>
              ) : (
                <pre className="skill-preview-content">{previewContent ?? ""}</pre>
              )}
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}
    </div>
  );
}

function ThemeTab() {
  const { theme, setTheme } = useTheme();
  const themes: { id: AppTheme; label: string; icon: typeof Sun; title: string }[] = [
    { id: "dark", label: "Dark", icon: Moon, title: "Graphite canvas with orange accent — the default Basebuild theme." },
    { id: "light", label: "Light", icon: Sun, title: "Soft neutral canvas with deeper accent for contrast." },
  ];
  return (
    <div className="stack">
      <h3>Theme</h3>
      <p className="text-muted text-sm">Choose the color scheme for the Basebuild interface. The theme is stored locally and applied before the app paints to avoid flash.</p>
      <div className="theme-picker">
        {themes.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              className={`btn theme-picker-card${theme === t.id ? " btn-primary" : ""}`}
              type="button"
              title={t.title}
              aria-pressed={theme === t.id}
              onClick={() => setTheme(t.id)}
            >
              <Icon size={24} />
              <span>{t.label}</span>
              {theme === t.id ? <Check size={12} /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}