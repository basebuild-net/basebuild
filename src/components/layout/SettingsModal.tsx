import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Download, Lock, RefreshCw, Settings2, Shield, Trash2, X } from "lucide-react";
import { ConfigPanel } from "../panels/ConfigPanel";
import { listRequirements, type RequirementStatus } from "../../lib/requirements";
import { checkForUpdates, installUpdate, type UpdateInfo } from "../../lib/updater";
import { appVersion } from "../../lib/app";
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

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
  projectPath: string | null;
};

type Tab = "updates" | "defaults" | "permissions" | "privacy" | "configs" | "about";

export function SettingsModal({ open, onClose, projectPath }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("updates");
  const [requirements, setRequirements] = useState<RequirementStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
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

  useEffect(() => {
    if (!open) return;
    void refreshReq();
    void appVersion().then(setVersion).catch(() => {});
    void refreshDefaults();
    void refreshPermissions();
    void refreshAnalytics();
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

  async function checkUpdates() {
    setUpdateLoading(true);
    try {
      const info = await checkForUpdates();
      setUpdateInfo(info);
    } catch (e) {
      setUpdateInfo({ available: false, version: null, notes: `Error checking: ${e}`, downloadUrl: null });
    } finally {
      setUpdateLoading(false);
    }
  }

  async function doInstall() {
    setInstalling(true);
    try {
      await installUpdate();
    } catch (e) {
      setUpdateInfo({ available: false, version: null, notes: `Install failed: ${e}`, downloadUrl: null });
    } finally {
      setInstalling(false);
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
    { id: "configs", label: "Config Packs", icon: Settings2 },
    { id: "about", label: "About", icon: Check },
  ];

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
                <div className="row gap-sm" style={{ marginBottom: 8 }}>
                  <h3>App Updates</h3>
                  <button
                    className="btn btn-sm"
                    type="button"
                    title="Check for updates"
                    onClick={() => void checkUpdates()}
                    disabled={updateLoading}
                  >
                    <RefreshCw size={12} className={updateLoading ? "spin" : ""} /> Check for updates
                  </button>
                </div>
                {updateInfo?.available ? (
                  <div className="requirement-row is-ok">
                    <span className="requirement-badge is-ok">↓</span>
                    <div>
                      <div className="requirement-name">Version {updateInfo.version} available</div>
                      {updateInfo.notes ? <div className="requirement-detail text-muted text-sm">{updateInfo.notes}</div> : null}
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        title="Download and install update"
                        onClick={() => void doInstall()}
                        disabled={installing}
                        style={{ marginTop: 6 }}
                      >
                        <Download size={12} /> {installing ? "Installing…" : "Download and install"}
                      </button>
                    </div>
                  </div>
                ) : updateInfo ? (
                  <p className="text-muted text-sm">{updateInfo.notes ?? "You're on the latest version."}</p>
                ) : null}

                <div className="row gap-sm" style={{ marginTop: 16, marginBottom: 8 }}>
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
                      <div className="requirement-detail text-muted text-sm">No usage data is being collected or uploaded.</div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ─── Config Packs ─── */}
            {tab === "configs" ? <ConfigPanel projectPath={projectPath} /> : null}

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
