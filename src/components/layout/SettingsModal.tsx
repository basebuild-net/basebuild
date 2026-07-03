import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Download, Globe, Key, Lock, LogOut, Plug, RefreshCw, Settings2, Shield, Trash2, Unplug, User, X } from "lucide-react";
import { ConfigPanel } from "../panels/ConfigPanel";
import { CopyButton } from "./CopyButton";
import { listRequirements, type RequirementStatus } from "../../lib/requirements";
import { type UpdaterState } from "../../state/updater";
import { appVersion } from "../../lib/app";
import { authStartDeviceFlow, authPollDeviceFlow, type PollResult } from "../../lib/auth";
import { useAccount, type AccountState } from "../../state/account";
import { useUsageSync } from "../../state/usageSync";
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
  mcpReload,
  mcpListServers,
  mcpDisconnect,
  mcpOAuthStart,
  mcpOAuthPoll,
  mcpOAuthCancel,
  type ServerState as McpServerState,
  type LoadResult as McpLoadResult,
} from "../../lib/mcp";

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
  projectPath: string | null;
  account: AccountState;
  updates: UpdaterState;
};

type Tab = "updates" | "defaults" | "permissions" | "privacy" | "account" | "configs" | "mcp" | "about";

export function SettingsModal({ open, onClose, projectPath, account, updates }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("updates");
  const [requirements, setRequirements] = useState<RequirementStatus[]>([]);
  const [loading, setLoading] = useState(false);
  // App version — compiled in at build time. Shows "0.0.0" in dev; the real
  // version in release builds (set by .github/workflows/windows.yml).
  const [version, setVersion] = useState("");

  // Defaults state
  const [defaults, setDefaults] = useState<RuntimeDefaults | null>(null);
  const [profiles, setProfiles] = useState<RuntimeProfile[]>([]);
  const [profileValidations, setProfileValidations] = useState<Record<string, ProfileValidation>>({});

  // Permissions state
  const [permissions, setPermissions] = useState<PermissionRules | null>(null);

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
    void refreshPermissions();
    void refreshAnalytics();
    if (projectPath) void refreshMcp();
  }, [open]);

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
      const [d, p] = await Promise.all([getRuntimeDefaults(), listRuntimeProfiles()]);
      setDefaults(d);
      setProfiles(p);
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

  async function refreshAnalytics() {
    try {
      const [c, count] = await Promise.all([getAnalyticsConsent(), analyticsEventCount()]);
      setConsent(c);
      setEventCount(count);
    } catch {
      // ignore
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
    { id: "account", label: "Account", icon: User },
    { id: "configs", label: "Config Packs", icon: Settings2 },
    { id: "mcp", label: "MCP Servers", icon: Plug },
    { id: "about", label: "About", icon: Check },
  ];

  const updateChecking = updates.status === "checking";
  const updateInstalling = updates.status === "installing";
  // Latest version: explicit when an update is available; otherwise the
  // running version is the latest (up-to-date). Unknown until checked.
  const latestVersion =
    updates.info?.version ??
    (updates.status === "up_to_date" ? (version || "—") : "—");

  return (
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
                    <label className="stack-sm">
                      <span className="text-sm text-muted">Default chat adapter</span>
                      <select
                        className="input"
                        title="Select default chat adapter"
                        value={defaults.defaultChatProfileId ?? ""}
                        onChange={(e) => void saveDefaults({ ...defaults, defaultChatProfileId: e.target.value || null })}
                      >
                        {chatProfiles.map((p) => {
                          const v = profileValidations[p.id];
                          return (
                            <option key={p.id} value={p.id}>
                              {p.label}{v && !v.valid ? " (unavailable)" : ""}
                            </option>
                          );
                        })}
                      </select>
                    </label>

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
                      <span className="text-sm text-muted">Default terminal</span>
                      <select
                        className="input"
                        title="Select default terminal"
                        value={defaults.defaultTerminalProfileId ?? ""}
                        onChange={(e) => void saveDefaults({ ...defaults, defaultTerminalProfileId: e.target.value || null })}
                      >
                        {terminalProfiles.map((p) => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </select>
                    </label>

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

                    <label className="row gap-sm" style={{ marginTop: 4 }}>
                      <input
                        type="checkbox"
                        title="Auto-send generated prompts — disabled by default for safety"
                        checked={defaults.autoSendGeneratedPrompts}
                        onChange={(e) => void saveDefaults({ ...defaults, autoSendGeneratedPrompts: e.target.checked })}
                      />
                      <span className="text-sm">Auto-send generated prompts</span>
                    </label>
                    <p className="text-muted text-sm" style={{ marginTop: -4 }}>
                      When enabled, prompts from Generate from context are sent immediately. Disabled by default.
                    </p>
                  </>
                ) : (
                  <p className="text-muted">Loading defaults…</p>
                )}

                {/* Profile validation */}
                <div style={{ marginTop: 12 }}>
                  <h4 className="text-sm text-muted" style={{ marginBottom: 6 }}>Adapter health</h4>
                  {profiles.map((p) => {
                    const v = profileValidations[p.id];
                    return (
                      <div key={p.id} className={`requirement-row is-${v?.valid ? "ok" : "attention"}`} style={{ marginBottom: 4 }}>
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
                  title="Reset defaults to conservative values"
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
                    <label className="row gap-sm" style={{ marginTop: 4 }}>
                      <input
                        type="checkbox"
                        title="Enable local usage analytics — stored on this device only"
                        checked={consent.collectionEnabled}
                        onChange={(e) => void saveConsent({ ...consent, collectionEnabled: e.target.checked })}
                      />
                      <span className="text-sm">Enable local usage analytics</span>
                    </label>
                    <p className="text-muted text-sm" style={{ marginTop: -4 }}>
                      Stores privacy-safe metadata (event name, feature area, outcome, duration) on this device only.
                    </p>

                    <label className="row gap-sm" style={{ marginTop: 4 }}>
                      <input
                        type="checkbox"
                        title="Enable remote upload of anonymous analytics — separate from local collection"
                        checked={consent.uploadEnabled}
                        disabled={!consent.collectionEnabled}
                        onChange={(e) => void saveConsent({ ...consent, uploadEnabled: e.target.checked })}
                      />
                      <span className="text-sm">Enable anonymous upload</span>
                    </label>
                    <p className="text-muted text-sm" style={{ marginTop: -4 }}>
                      Upload is disabled until a reviewed endpoint is configured. No upload code runs unless this is enabled.
                    </p>

                    <div style={{ marginTop: 8 }}>
                      <h4 className="text-sm text-muted" style={{ marginBottom: 6 }}>Local analytics data</h4>
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
                  <div className="requirement-row is-ok" style={{ marginTop: 8 }}>
                    <span className="requirement-badge is-ok">✓</span>
                    <div>
                      <div className="requirement-name">Analytics disabled</div>
                      <div className="text-muted text-sm">No data leaves this device.</div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

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

            {/* ─── About ─── */}
            {tab === "about" ? (
              <div className="stack">
                <h3>Basebuild</h3>
                <p className="text-muted">Version {version || "…"}</p>
                <p className="text-muted text-sm">
                  Desktop application for managing OMP terminals, source control,
                  ideas, and plans.
                </p>
                <div className="row gap-sm" style={{ marginTop: 8 }}>
                  <a
                    className="btn btn-sm"
                    href="https://github.com/basebuild-net/basebuild/issues/new?labels=bug&template=bug_report.md&title=Bug:"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Report a bug
                  </a>
                  <a
                    className="btn btn-sm"
                    href="https://github.com/basebuild-net/basebuild"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function PermissionSelect({ label, title, value, onChange }: {
  label: string;
  title: string;
  value: PermissionDecision;
  onChange: (v: PermissionDecision) => void;
}) {
  return (
    <label className="stack-sm" style={{ marginBottom: 8 }}>
      <span className="text-sm text-muted">{label}</span>
      <select
        className="input"
        title={title}
        value={value}
        onChange={(e) => onChange(e.target.value as PermissionDecision)}
      >
        <option value="ask">Ask before each action</option>
        <option value="allow">Allow automatically</option>
        <option value="deny">Deny automatically</option>
      </select>
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
  const { status, projected, loading, error, lastSyncResult, fetchProjected, triggerSync, setEnabled } =
    useUsageSync(signedIn);
  const [toggling, setToggling] = useState(false);
  const [syncing, setSyncing] = useState(false);

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

  const liveRows = projected?.live.rows ?? [];
  const snapshotRows = projected?.snapshot.rows ?? [];

  return (
    <div className="stack">
      <h3>Usage Sync</h3>
      <p className="text-muted text-sm">
        Sync your OMP usage to basebuild.net. The app sends only aggregated usage stats
        (model, provider, tokens, cost, timing) — never prompts, source code, or secrets.
      </p>

      <div className="row gap-sm" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <label className="row gap-sm" style={{ alignItems: "center" }}>
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
    </div>
  );
}

function ModelProvidersPanel() {
  const [catalog, setCatalog] = useState<NativeProviderCatalog | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
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
        await nativeSaveProviderCredential({ providerId, label, apiKey: key, baseUrl: null });
        setKeyDrafts((prev) => ({ ...prev, [providerId]: "" }));
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [keyDrafts, refresh],
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
    <div className="stack" style={{ marginTop: 16 }}>
      <h3>Model Providers</h3>
      <p className="text-muted text-sm">
        Connect model providers with a web flow or an API key. Credentials are stored locally on this device only.
      </p>
      {providers.map((p) => (
        <div key={p.id} className="requirement-row" style={{ alignItems: "flex-start" }}>
          <span className={`requirement-badge is-${p.configured ? "ok" : "attention"}`}>
            {p.configured ? "✓" : "!"}
          </span>
          <div style={{ flex: 1 }}>
            <div className="requirement-name">
              {p.label} {p.configured ? <span className="text-muted text-sm">connected</span> : null}
            </div>
            {p.configured ? (
              <button
                className="btn btn-sm"
                type="button"
                title={`Disconnect ${p.label}`}
                disabled={busyId === p.id}
                onClick={() => void disconnect(p.id)}
                style={{ marginTop: 6 }}
              >
                <Unplug size={12} /> Disconnect
              </button>
            ) : busyId === p.id ? (
              <div className="row gap-sm" style={{ marginTop: 6 }}>
                <span className="text-muted text-sm">Waiting for browser…</span>
                <button className="btn btn-sm" type="button" title="Cancel" onClick={() => cancelWeb(p.id)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="stack-sm" style={{ marginTop: 6 }}>
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
              </div>
            )}
          </div>
        </div>
      ))}
      {error ? <p className="text-danger text-sm">{error}</p> : null}
    </div>
  );
}