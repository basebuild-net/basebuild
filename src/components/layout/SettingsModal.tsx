import { useEffect, useState } from "react";
import { Check, Download, RefreshCw, Settings2, X } from "lucide-react";
import { ConfigPanel } from "../panels/ConfigPanel";
import { listRequirements, type RequirementStatus } from "../../lib/requirements";
import { checkForUpdates, installUpdate, type UpdateInfo } from "../../lib/updater";
type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
  projectPath: string | null;
};

type Tab = "updates" | "configs" | "about";

export function SettingsModal({ open, onClose, projectPath }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("updates");
  const [requirements, setRequirements] = useState<RequirementStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!open) return;
    void refreshReq();
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

  if (!open) return null;

  const tabs: { id: Tab; label: string; icon: typeof Settings2 }[] = [
    { id: "updates", label: "Updates", icon: RefreshCw },
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
                  onClick={() => setTab(t.id)}
                >
                  <Icon size={14} />
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="settings-content">
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
                    title="Refresh"
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
            {tab === "configs" ? <ConfigPanel projectPath={projectPath} /> : null}
            {tab === "about" ? (
              <div className="stack">
                <h3>Basebuild</h3>
                <p className="text-muted">Version 0.0.1</p>
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
