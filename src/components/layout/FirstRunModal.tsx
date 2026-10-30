import { useEffect, useState } from "react";
import { Moon, Sun, TerminalSquare } from "lucide-react";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { getAnalyticsConsent, setAnalyticsConsent, type AnalyticsConsent } from "../../lib/analytics";
import { startupEnable, startupDisable, startupGetStatus, type StartupRegistrationStatus } from "../../lib/startup";
import { ModalPortal } from "../ModalPortal";
import { LanguagePicker } from "./LanguagePicker";
import { useTheme, type AppTheme } from "../../state/useTheme";
import { useLogs } from "../../state/log";
import { t } from "../../i18n";

type FirstRunModalProps = {
  open: boolean;
  onComplete: () => void;
  onSkip: () => void;
};

const USAGE_CONSENT_VERSION = "usage-sharing-v1";

const THEME_CHOICES: { id: AppTheme; label: () => string; Icon: typeof Moon }[] = [
  { id: "dark", label: () => t("firstRunModal.dark"), Icon: Moon },
  { id: "light", label: () => t("firstRunModal.light"), Icon: Sun },
];

/**
 * One-sheet welcome. Nothing is persisted until "Get started": usage sharing
 * is opt-in (off by default) and Skip/Escape registers no OS startup entry.
 */
export function FirstRunModal({ open, onComplete, onSkip }: FirstRunModalProps) {
  const { addLog } = useLogs();
  const { theme, setTheme } = useTheme();
  const [consent, setConsent] = useState<AnalyticsConsent | null>(null);
  const [launchAtSignin, setLaunchAtSignin] = useState(true);
  const [startupStatus, setStartupStatus] = useState<StartupRegistrationStatus | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEscapeKey(open, onSkip);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const [c, s] = await Promise.all([getAnalyticsConsent(), startupGetStatus().catch(() => null)]);
        // Usage sharing is opt-in: the checkbox starts from the stored choice,
        // which is off on a fresh install.
        setConsent(c);
        setStartupStatus(s);
      } catch {
        // Settings can still change these later; the sheet stays usable.
      }
    })();
  }, [open]);

  if (!open) return null;

  const usageDraft: AnalyticsConsent = consent ?? {
    collectionEnabled: false,
    uploadEnabled: false,
    consentVersion: null,
    consentedAt: null,
  };
  const startupSupported = startupStatus?.platformSupported === true;

  function pickTheme(next: AppTheme) {
    addLog("debug", "First run: theme picked", { theme: next });
    setTheme(next);
  }

  function skip() {
    addLog("debug", "First run: skipped");
    onSkip();
  }

  async function getStarted() {
    if (saving) return;
    setSaving(true);
    addLog("debug", "First run: get started", { uploadEnabled: usageDraft.uploadEnabled, launchAtSignin });
    const finalized: AnalyticsConsent = {
      ...usageDraft,
      consentVersion: USAGE_CONSENT_VERSION,
      consentedAt: Math.floor(Date.now() / 1000),
    };
    try {
      await setAnalyticsConsent(finalized);
      setConsent(finalized);
      setConsentError(null);
    } catch (error) {
      setConsentError(error instanceof Error ? error.message : String(error));
      setSaving(false);
      return;
    }
    // Startup registration is applied only here. Skip never calls this, so a
    // dismissed sheet creates no OS registration. Failure is non-fatal.
    if (startupSupported) {
      try {
        const status = launchAtSignin ? await startupEnable() : await startupDisable();
        setStartupStatus(status);
      } catch {
        // The user can retry in Settings.
      }
    }
    setSaving(false);
    onComplete();
  }

  return (
    <ModalPortal>
      <div className="modal-overlay" onClick={skip}>
        <div
          className="modal modal-first-run"
          role="dialog"
          aria-modal="true"
          aria-labelledby="first-run-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header first-run-header">
            <div className="first-run-brand">
              <span className="first-run-mark" aria-hidden="true"><TerminalSquare size={16} /></span>
              <h2 id="first-run-title">{t("firstRunModal.welcomeToBasebuild")}</h2>
            </div>
          </div>

          <div className="modal-body stack first-run-body">
            <p className="text-muted text-sm first-run-tagline">{t("firstRunModal.tagline")}</p>

            <section className="first-run-field">
              <div className="first-run-label">{t("firstRunModal.chooseYourLanguage")}</div>
              <LanguagePicker />
            </section>

            <section className="first-run-field">
              <div className="first-run-label">{t("firstRunModal.chooseYourTheme")}</div>
              <div className="first-run-theme-options" role="group" aria-label={t("firstRunModal.chooseYourTheme")}>
                {THEME_CHOICES.map(({ id, label, Icon }) => {
                  const selected = theme === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`first-run-theme${selected ? " is-selected" : ""}`}
                      aria-pressed={selected}
                      title={t("firstRunModal.useMode", { toLowerCase: label().toLowerCase() })}
                      onClick={() => pickTheme(id)}
                    >
                      <Icon size={14} />
                      <span>{label()}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {startupSupported ? (
              <section className="first-run-field">
                <label className="first-run-check">
                  <input
                    type="checkbox"
                    title={t("firstRunModal.launchAtWindowsSignIn")}
                    checked={launchAtSignin}
                    onChange={(e) => {
                      addLog("debug", "First run: launch at sign-in toggled", { enabled: e.target.checked });
                      setLaunchAtSignin(e.target.checked);
                    }}
                  />
                  <span className="text-sm">{t("firstRunModal.launchAtWindowsSignIn")}</span>
                </label>
                <p className="text-muted text-xs first-run-hint">{t("firstRunModal.startupHint")}</p>
              </section>
            ) : null}

            <section className="first-run-field">
              <label className="first-run-check">
                <input
                  type="checkbox"
                  title={t("firstRunModal.shareAnonymousAggregateUsage")}
                  checked={usageDraft.uploadEnabled}
                  onChange={(e) => {
                    addLog("debug", "First run: usage sharing toggled", { enabled: e.target.checked });
                    setConsent({ ...usageDraft, uploadEnabled: e.target.checked });
                  }}
                />
                <span className="text-sm">{t("firstRunModal.shareAnonymousAggregateUsage")}</span>
              </label>
              <p className="text-muted text-xs first-run-hint">{t("firstRunModal.shareUsageHint")}</p>
            </section>

            {consentError ? <p className="text-danger text-sm">{consentError}</p> : null}
          </div>

          <div className="modal-footer first-run-actions">
            <button className="btn" type="button" title={t("firstRunModal.skipSetup")} onClick={skip}>
              {t("firstRunModal.skip")}
            </button>
            <button
              className="btn btn-primary"
              type="button"
              title={t("firstRunModal.getStarted")}
              disabled={saving}
              onClick={() => void getStarted()}
            >
              {t("firstRunModal.getStarted")}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
