import { useEffect, useState } from "react";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { Check, ChevronRight, Sparkles, TerminalSquare, X } from "lucide-react";
import { listRuntimeProfiles, getRuntimeDefaults, setRuntimeDefaults, type RuntimeProfile, type RuntimeDefaults } from "../../lib/settings";
import { RuntimeDefaultsFields } from "./RuntimeDefaultsFields";
import { getAnalyticsConsent, setAnalyticsConsent, type AnalyticsConsent } from "../../lib/analytics";
import { startupEnable, startupDisable, startupGetStatus, type StartupRegistrationStatus } from "../../lib/startup";

type FirstRunModalProps = {
  open: boolean;
  onComplete: () => void;
  onSkip: () => void;
};

type Step = "welcome" | "adapter" | "terminal" | "startup" | "privacy" | "done";

export function FirstRunModal({ open, onComplete, onSkip }: FirstRunModalProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [profiles, setProfiles] = useState<RuntimeProfile[]>([]);
  const [defaults, setDefaults] = useState<RuntimeDefaults | null>(null);
  useEscapeKey(open, onSkip);
  const [consent, setConsent] = useState<AnalyticsConsent | null>(null);
  const [launchAtSignin, setLaunchAtSignin] = useState(true);
  const [startupStatus, setStartupStatus] = useState<StartupRegistrationStatus | null>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const [p, d, c, s] = await Promise.all([listRuntimeProfiles(), getRuntimeDefaults(), getAnalyticsConsent(), startupGetStatus().catch(() => null)]);
        setProfiles(p);
        setDefaults(d);
        setConsent(c);
        setStartupStatus(s);
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
    // Apply the launch-at-sign-in preference only when the user finishes
    // setup. Skip/Escape does NOT call this function, so no OS registration
    // is created as a side effect of a dismissed setup.
    try {
      if (launchAtSignin) {
        const status = await startupEnable();
        setStartupStatus(status);
      } else {
        const status = await startupDisable();
        setStartupStatus(status);
      }
    } catch {
      // Registration failure is non-fatal — the user can retry in Settings.
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
              <RuntimeDefaultsFields
                defaults={defaults}
                chatProfiles={chatProfiles}
                terminalProfiles={terminalProfiles}
                onChange={(d) => setDefaults(d)}
              />
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
              <RuntimeDefaultsFields
                defaults={defaults}
                chatProfiles={chatProfiles}
                terminalProfiles={terminalProfiles}
                onChange={(d) => setDefaults(d)}
              />
              <div className="row">
                <button className="btn" type="button" title="Go back" onClick={() => setStep("adapter")}>Back</button>
                <button className="btn btn-primary" type="button" title="Continue to Windows startup setup" onClick={() => void saveDefaultsAndAdvance(defaults, "startup")}>
                  Next <ChevronRight size={12} />
                </button>
              </div>
            </>
          ) : null}

          {step === "startup" ? (
            <>
              <h3>Windows startup</h3>
              <p className="text-muted text-sm">
                Launch Basebuild automatically when you sign in to Windows.
                It starts minimized in the system tray — no window pops up.
                You can change this anytime in Settings.
              </p>
              {startupStatus && !startupStatus.platformSupported ? (
                <p className="text-muted text-sm">
                  Automatic startup is not supported on this platform.
                </p>
              ) : (
                <label className="row gap-sm">
                  <input
                    type="checkbox"
                    title="Launch Basebuild at Windows sign-in (minimized to tray)"
                    checked={launchAtSignin}
                    onChange={(e) => setLaunchAtSignin(e.target.checked)}
                  />
                  <span className="text-sm">Launch at Windows sign-in (minimized to tray)</span>
                </label>
              )}
              <div className="row">
                <button className="btn" type="button" title="Go back" onClick={() => setStep("terminal")}>Back</button>
                <button className="btn btn-primary" type="button" title="Continue to privacy setup" onClick={() => void setStep("privacy")}>
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
                <button className="btn" type="button" title="Go back" onClick={() => setStep("startup")}>Back</button>
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
