import { useEffect, useState } from "react";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { Check, ChevronRight, Moon, Sun, TerminalSquare, X } from "lucide-react";
import { listRuntimeProfiles, getRuntimeDefaults, setRuntimeDefaults, type RuntimeProfile, type RuntimeDefaults } from "../../lib/settings";
import { RuntimeDefaultsFields } from "./RuntimeDefaultsFields";
import { getAnalyticsConsent, setAnalyticsConsent, type AnalyticsConsent } from "../../lib/analytics";
import { startupEnable, startupDisable, startupGetStatus, type StartupRegistrationStatus } from "../../lib/startup";
import { ModalPortal } from "../ModalPortal";
import { useTheme, type AppTheme } from "../../state/useTheme";
import { t } from "../../i18n";

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
  const [consentError, setConsentError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const [p, d, c, s] = await Promise.all([listRuntimeProfiles(), getRuntimeDefaults(), getAnalyticsConsent(), startupGetStatus().catch(() => null)]);
        setProfiles(p);
        setDefaults(d);
        // Usage sharing is opt-in: the checkbox starts from the stored choice,
        // which is off on a fresh install. Nothing is persisted until Finish.
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
    const finalizedConsent = {
      ...c,
      consentVersion: "usage-sharing-v1",
      consentedAt: Math.floor(Date.now() / 1000),
    };
    try {
      await setAnalyticsConsent(finalizedConsent);
      setConsent(finalizedConsent);
      setConsentError(null);
    } catch (error) {
      setConsentError(error instanceof Error ? error.message : String(error));
      return;
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
          <h2>{t("firstRunModal.welcomeToBasebuild")}</h2>
          <button className="btn-icon" title={t("firstRunModal.skipSetup")} type="button" onClick={onSkip}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body stack modal-first-run-body">
          {step === "theme" ? (
            <>
              <h3>{t("firstRunModal.chooseYourTheme")}</h3>
              <p className="text-muted text-sm">
                {t("firstRunModal.startWithDarkOrLight")}
              </p>
              <div className="theme-picker">
                {([
                  { id: "dark", label: t("firstRunModal.dark"), icon: Moon },
                  { id: "light", label: t("firstRunModal.light"), icon: Sun },
                ] as { id: AppTheme; label: string; icon: typeof Moon }[]).map((choice) => {
                  const Icon = choice.icon;
                  return (
                    <button
                      key={choice.id}
                      className={`btn theme-picker-card${theme === choice.id ? " btn-primary" : ""}`}
                      type="button"
                      title={t("firstRunModal.useMode", { toLowerCase: choice.label.toLowerCase() })}
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
              <h3>{t("firstRunModal.localFirstDesktopControlPlane")}</h3>
              <p className="text-muted text-sm">
                {t("firstRunModal.basebuildRunsAiCodingAgents")}
              </p>
              <div className="row">
                <button className="btn btn-primary" type="button" title={t("firstRunModal.startSetup")} onClick={() => setStep("adapter")}>
                  {t("firstRunModal.getStarted")} <ChevronRight size={12} />
                </button>
                <button className="btn btn-ghost" type="button" title={t("firstRunModal.skipAndUseConservativeDefaults")} onClick={onSkip}>
                  {t("firstRunModal.skip")}
                </button>
              </div>
            </>
          ) : null}

          {step === "adapter" && defaults ? (
            <>
              <h3>{t("firstRunModal.chooseYourChatAdapter")}</h3>
              <p className="text-muted text-sm">{t("firstRunModal.theBasebuildNativeAgentLoop")}</p>
              <RuntimeDefaultsFields
                defaults={defaults}
                chatProfiles={chatProfiles}
                terminalProfiles={terminalProfiles}
                onChange={(d) => setDefaults(d)}
              />
              <div className="row">
                <button className="btn" type="button" title={t("firstRunModal.goBack")} onClick={() => setStep("welcome")}>{t("firstRunModal.back")}</button>
                <button className="btn btn-primary" type="button" title={t("firstRunModal.continueToTerminalSetup")} onClick={() => void saveDefaultsAndAdvance(defaults, "terminal")}>
                  {t("firstRunModal.next")} <ChevronRight size={12} />
                </button>
              </div>
            </>
          ) : null}

          {step === "terminal" && defaults ? (
            <>
              <h3>{t("firstRunModal.chooseYourTerminal")}</h3>
              <RuntimeDefaultsFields
                defaults={defaults}
                chatProfiles={chatProfiles}
                terminalProfiles={terminalProfiles}
                onChange={(d) => setDefaults(d)}
              />
              <div className="row">
                <button className="btn" type="button" title={t("firstRunModal.goBack")} onClick={() => setStep("adapter")}>{t("firstRunModal.back")}</button>
                <button className="btn btn-primary" type="button" title={t("firstRunModal.continueToWindowsStartupSetup")} onClick={() => void saveDefaultsAndAdvance(defaults, "startup")}>
                  {t("firstRunModal.next")} <ChevronRight size={12} />
                </button>
              </div>
            </>
          ) : null}

          {step === "startup" ? (
            <>
              <h3>{t("firstRunModal.windowsStartup")}</h3>
              <p className="text-muted text-sm">
                {t("firstRunModal.launchBasebuildAutomaticallyWhenYou")}
              </p>
              {startupStatus && !startupStatus.platformSupported ? (
                <p className="text-muted text-sm">
                  {t("firstRunModal.automaticStartupIsNotSupported")}
                </p>
              ) : (
                <label className="row gap-sm">
                  <input
                    type="checkbox"
                    title={t("firstRunModal.launchBasebuildAtWindowsSign")}
                    checked={launchAtSignin}
                    onChange={(e) => setLaunchAtSignin(e.target.checked)}
                  />
                  <span className="text-sm">{t("firstRunModal.launchAtWindowsSignIn")}</span>
                </label>
              )}
              <div className="row">
                <button className="btn" type="button" title={t("firstRunModal.goBack")} onClick={() => setStep("terminal")}>{t("firstRunModal.back")}</button>
                <button className="btn btn-primary" type="button" title={t("firstRunModal.continueToPrivacySetup")} onClick={() => void setStep("privacy")}>
                  {t("firstRunModal.next")} <ChevronRight size={12} />
                </button>
              </div>
            </>
          ) : null}

          {step === "privacy" && consent ? (
            <>
              <h3>{t("firstRunModal.helpImproveBasebuild")}</h3>
              <p className="text-muted text-sm">
                {t("firstRunModal.anonymousAggregateUsageSharingIs")}
              </p>
              <label className="row gap-sm">
                <input
                  type="checkbox"
                  title={t("firstRunModal.shareAnonymousAggregateUsageWith")}
                  checked={consent.uploadEnabled}
                  onChange={(e) => setConsent({
                    ...consent,
                    uploadEnabled: e.target.checked,
                  })}
                />
                <span className="text-sm">{t("firstRunModal.shareAnonymousAggregateUsage")}</span>
              </label>
              {consentError ? <p className="text-danger text-sm">{consentError}</p> : null}
              <div className="row">
                <button className="btn" type="button" title={t("firstRunModal.goBack")} onClick={() => setStep("startup")}>{t("firstRunModal.back")}</button>
                <button className="btn btn-primary" type="button" title={t("firstRunModal.finishSetup")} onClick={() => void saveConsentAndFinish(consent)}>
                  {t("firstRunModal.finish")} <Check size={12} />
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
