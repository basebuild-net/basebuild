import { useEffect, useState } from "react";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { Check, ChevronRight, Moon, Sun, TerminalSquare, X } from "lucide-react";
import { listRuntimeProfiles, getRuntimeDefaults, setRuntimeDefaults, type RuntimeProfile, type RuntimeDefaults } from "../../lib/settings";
import { RuntimeDefaultsFields } from "./RuntimeDefaultsFields";
import { getAnalyticsConsent, setAnalyticsConsent, type AnalyticsConsent } from "../../lib/analytics";
import { startupEnable, startupDisable, startupGetStatus, type StartupRegistrationStatus } from "../../lib/startup";
import { ModalPortal } from "../ModalPortal";
import { useTheme, type AppTheme } from "../../state/useTheme";

type FirstRunModalProps = {
  open: boolean;
  onComplete: () => void;
  onSkip: () => void;
};

type Step = "theme" | "welcome" | "adapter" | "terminal" | "startup" | "privacy";

export function FirstRunModal({ open, onComplete, onSkip }: FirstRunModalProps) {
  const [step, setStep] = useState<Step>("theme");
  const { theme, setTheme } = useTheme();
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
        // Usage sharing is OPT-IN: default OFF. Use the stored consent (which
        // the backend seeds disabled) rather than pre-checking the box, so
        // nothing is shared unless the user explicitly turns it on here or in
        // Settings → Privacy.
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
      // Registration failure is non-fatal. The user can retry in Settings.
    }
    onComplete();
  }

  return (
    <ModalPortal>
    <div className="modal-overlay" onClick={onSkip}>
      <div className="modal modal-first-run" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Welcome to Basebuild</h2>
          <button className="btn-icon" title="Skip setup" type="button" onClick={onSkip}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body stack modal-first-run-body">
          {step === "theme" ? (
            <>
              <h3>Choose your theme</h3>
              <p className="text-muted text-sm">
                Start with dark or light mode. You can change this anytime in Settings.
              </p>
              <div className="theme-picker">
                {([
                  { id: "dark", label: "Dark", icon: Moon },
                  { id: "light", label: "Light", icon: Sun },
                ] as { id: AppTheme; label: string; icon: typeof Moon }[]).map((choice) => {
                  const Icon = choice.icon;
                  return (
                    <button
                      key={choice.id}
                      className={`btn theme-picker-card${theme === choice.id ? " btn-primary" : ""}`}
                      type="button"
                      title={`Use ${choice.label.toLowerCase()} mode`}
                      aria-pressed={theme === choice.id}
                      onClick={() => {
                        setTheme(choice.id);
                        setStep("welcome");
                      }}
                    >
                      <Icon size={24} />
                      <span>{choice.label}</span>
                      {theme === choice.id ? <Check size={12} /> : null}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {step === "welcome" ? (
            <>
              <TerminalSquare size={32} className="text-muted" />
              <h3>Local-first desktop control plane for AI coding agents</h3>
              <p className="text-muted text-sm">
                Basebuild runs AI coding agents through its own native agent loop,
                with an integrated terminal, source control, and a planning pipeline.
                Let's set up your defaults; this takes 10 seconds and everything stays local.
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
              <p className="text-muted text-sm">The Basebuild native agent loop is the default. Optional adapters like OMP appear here when installed.</p>
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
              <h3>Help improve Basebuild</h3>
              <p className="text-muted text-sm">
                Share anonymous usage stats with basebuild.net so we can build the features people actually use?
                Aggregates only — model, provider, tokens, cost, timing. Never your name, prompts, source code, or secrets.
                Off by default; turn it on or off anytime in Settings → Privacy, and control what shows publicly on your basebuild.net account.
              </p>
              <label className="row gap-sm">
                <input
                  type="checkbox"
                  title="Share anonymous usage stats with basebuild.net (optional, off by default)"
                  checked={consent.collectionEnabled && consent.uploadEnabled}
                  onChange={(e) => setConsent({
                    ...consent,
                    collectionEnabled: e.target.checked,
                    uploadEnabled: e.target.checked,
                  })}
                />
                <span className="text-sm">Share anonymous usage stats (optional)</span>
              </label>
              <div className="row">
                <button className="btn" type="button" title="Go back" onClick={() => setStep("startup")}>Back</button>
                <button className="btn btn-primary" type="button" title="Finish setup" onClick={() => void saveConsentAndFinish(consent)}>
                  Finish <Check size={12} />
                </button>
              </div>
            </>
          ) : null}

        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
