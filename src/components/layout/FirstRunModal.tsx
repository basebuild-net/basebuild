import { useEffect, useState } from "react";
import { Check, ChevronRight, Sparkles, TerminalSquare, X } from "lucide-react";
import { listRuntimeProfiles, getRuntimeDefaults, setRuntimeDefaults, type RuntimeProfile, type RuntimeDefaults } from "../../lib/settings";
import { getAnalyticsConsent, setAnalyticsConsent, type AnalyticsConsent } from "../../lib/analytics";

type FirstRunModalProps = {
  open: boolean;
  onComplete: () => void;
  onSkip: () => void;
};

type Step = "welcome" | "adapter" | "terminal" | "privacy" | "done";

export function FirstRunModal({ open, onComplete, onSkip }: FirstRunModalProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [profiles, setProfiles] = useState<RuntimeProfile[]>([]);
  const [defaults, setDefaults] = useState<RuntimeDefaults | null>(null);
  const [consent, setConsent] = useState<AnalyticsConsent | null>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const [p, d, c] = await Promise.all([listRuntimeProfiles(), getRuntimeDefaults(), getAnalyticsConsent()]);
        setProfiles(p);
        setDefaults(d);
        setConsent(c);
      } catch {
        // ignore
      }
    })();
  }, [open]);

  if (!open) return null;

  const chatProfiles = profiles.filter((p) => p.kind === "chat");
  const terminalProfiles = profiles.filter((p) => p.kind === "terminal");

  async function saveDefaultsAndAdvance(d: RuntimeDefaults, next: Step) {
    try {
      await setRuntimeDefaults(d);
      setDefaults(d);
    } catch {
      // ignore
    }
    setStep(next);
  }

  async function saveConsentAndFinish(c: AnalyticsConsent) {
    try {
      await setAnalyticsConsent(c);
      setConsent(c);
    } catch {
      // ignore
    }
    setStep("done");
  }

  return (
    <div className="modal-overlay" onClick={onSkip}>
      <div className="modal modal-first-run" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Welcome to Basebuild</h2>
          <button className="btn-icon" title="Skip setup" type="button" onClick={onSkip}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body stack modal-first-run-body">
          {step === "welcome" ? (
            <>
              <TerminalSquare size={32} className="text-muted" />
              <h3>Local-first desktop control plane for AI coding agents</h3>
              <p className="text-muted text-sm">
                Basebuild wraps OMP and terminal tools in a unified desktop shell.
                Let's set up your defaults — this takes 10 seconds and everything stays local.
              </p>
              <div className="row">
                <button className="btn btn-primary" type="button" title="Start setup" onClick={() => setStep("adapter")}>
                  Get started <ChevronRight size={12} />
                </button>
                <button className="btn btn-ghost" type="button" title="Skip and use conservative defaults" onClick={onSkip}>
                  Skip
                </button>
              </div>
            </>
          ) : null}

          {step === "adapter" && defaults ? (
            <>
              <h3>Choose your chat adapter</h3>
              <p className="text-muted text-sm">OMP is the default. Future adapters (Basebuild CLI, others) will appear here.</p>
              <label className="stack-sm">
                <span className="text-sm text-muted">Default chat adapter</span>
                <select
                  className="input"
                  title="Select your default chat adapter"
                  value={defaults.defaultChatProfileId ?? ""}
                  onChange={(e) => setDefaults({ ...defaults, defaultChatProfileId: e.target.value || null })}
                >
                  {chatProfiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>
              <div className="row">
                <button className="btn" type="button" title="Go back" onClick={() => setStep("welcome")}>Back</button>
                <button className="btn btn-primary" type="button" title="Continue to terminal setup" onClick={() => void saveDefaultsAndAdvance(defaults, "terminal")}>
                  Next <ChevronRight size={12} />
                </button>
              </div>
            </>
          ) : null}

          {step === "terminal" && defaults ? (
            <>
              <h3>Choose your terminal</h3>
              <label className="stack-sm">
                <span className="text-sm text-muted">Default terminal</span>
                <select
                  className="input"
                  title="Select your default terminal"
                  value={defaults.defaultTerminalProfileId ?? ""}
                  onChange={(e) => setDefaults({ ...defaults, defaultTerminalProfileId: e.target.value || null })}
                >
                  {terminalProfiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>
              <div className="row">
                <button className="btn" type="button" title="Go back" onClick={() => setStep("adapter")}>Back</button>
                <button className="btn btn-primary" type="button" title="Continue to privacy setup" onClick={() => void saveDefaultsAndAdvance(defaults, "privacy")}>
                  Next <ChevronRight size={12} />
                </button>
              </div>
            </>
          ) : null}

          {step === "privacy" && consent ? (
            <>
              <h3>Privacy</h3>
              <p className="text-muted text-sm">
                Basebuild is local-first. Analytics are disabled by default and never store
                prompt text, chat content, or source code.
              </p>
              <label className="row gap-sm">
                <input
                  type="checkbox"
                  title="Enable local usage analytics — stored on this device only, no upload"
                  checked={consent.collectionEnabled}
                  onChange={(e) => setConsent({ ...consent, collectionEnabled: e.target.checked })}
                />
                <span className="text-sm">Enable local usage analytics (optional)</span>
              </label>
              <div className="row">
                <button className="btn" type="button" title="Go back" onClick={() => setStep("terminal")}>Back</button>
                <button className="btn btn-primary" type="button" title="Finish setup" onClick={() => void saveConsentAndFinish(consent)}>
                  Finish <Check size={12} />
                </button>
              </div>
            </>
          ) : null}

          {step === "done" ? (
            <>
              <Check size={32} className="text-ok" />
              <h3>You're all set</h3>
              <p className="text-muted text-sm">
                You can change these anytime in Settings. Basebuild is local-first —
                no data leaves your machine unless you explicitly enable it.
              </p>
              <button className="btn btn-primary" type="button" title="Start using Basebuild" onClick={onComplete}>
                <Sparkles size={12} /> Start using Basebuild
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
