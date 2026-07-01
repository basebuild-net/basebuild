import { useEffect, useState } from "react";
import { Check, RefreshCw, Settings2, X } from "lucide-react";
import { ConfigPanel } from "../panels/ConfigPanel";
import { listRequirements, type RequirementStatus } from "../../lib/requirements";

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
                <p className="text-muted">Version 0.1.0</p>
                <p className="text-muted text-sm">
                  Desktop application for managing OMP terminals, source control,
                  ideas, and autonomous workflows.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
