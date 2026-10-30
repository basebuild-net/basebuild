import { Loader2, Mic, MicOff, PhoneOff, Settings2, Volume2, X } from "lucide-react";
import type { VoiceProfile } from "../../../lib/voice";
import type { VoiceState } from "../../../state/useVoiceCall";
import { t } from "../../../i18n";

/**
 * The in-call strip above the composer. It answers one question at a glance:
 * is the microphone hearing me right now, or is something else happening?
 */

function STATE_LABELS(): Record<VoiceState, string> {
  return {
    off: t("voiceCallBar.callEnded"),
    idle: t("voiceCallBar.listening"),
    capturing: t("voiceCallBar.hearingYou"),
    transcribing: t("voiceCallBar.transcribing"),
    speaking: t("voiceCallBar.speaking"),
  };
}

function STATE_TITLES(): Record<VoiceState, string> {
  return {
    off: t("voiceCallBar.theCallIsNotActive"),
    idle: t("voiceCallBar.waitingForYouToSpeakJust"),
    capturing: t("voiceCallBar.capturingYourSpeechItSendsWhen"),
    transcribing: t("voiceCallBar.convertingYourSpeechToText"),
    speaking: t("voiceCallBar.readingTheReplyAloudTalkOver"),
  };
}

/** Eight bars is enough to read as a level meter without becoming decoration. */
const METER_BARS = 8;

export type VoiceCallBarProps = {
  state: VoiceState;
  /** Raw RMS from the analyser, roughly 0 to 0.3 for speech. */
  level: number;
  muted: boolean;
  /** Whether a call is actually active (vs just showing a permission error). */
  callActive: boolean;
  error: string | null;
  /** True when getUserMedia was blocked, not just unavailable. */
  permissionDenied: boolean;
  profile: VoiceProfile | null;
  modelName: string;
  onToggleMute: () => void;
  onEnd: () => void;
  onOpenSettings: () => void;
  /** Open the OS mic privacy settings so the user can re-grant access. */
  onOpenMicSettings: () => void;
  /** Reset the WebView2 mic permission and retry getUserMedia. */
  onResetMicPermission: () => void;
};

export function VoiceCallBar({
  state,
  level,
  muted,
  callActive,
  error,
  permissionDenied,
  profile,
  modelName,
  onToggleMute,
  onOpenMicSettings,
  onResetMicPermission,
  onOpenSettings,
  onEnd,
}: VoiceCallBarProps) {
  // Speech RMS lives in a narrow band near zero, so scale before clamping or
  // the meter never leaves the first bar.
  const normalized = muted ? 0 : Math.min(1, level * 12);
  const activeBars = Math.round(normalized * METER_BARS);

  return (
    <div className="voice-call-bar" data-voice-state={muted ? "muted" : state}>
      <div className="voice-call-status">
        {state === "transcribing" ? (
          <Loader2 size={13} className="voice-call-spinner" />
        ) : state === "speaking" ? (
          <Volume2 size={13} />
        ) : muted ? (
          <MicOff size={13} />
        ) : (
          <Mic size={13} />
        )}
        <span className="voice-call-state" title={muted ? t("voiceCallBar.microphoneMutedTheAgentCannot") : STATE_TITLES()[state]}>
          {muted ? t("voiceCallBar.muted") : STATE_LABELS()[state]}
        </span>
      </div>

      <div className="voice-level" title={t("voiceCallBar.microphoneInputLevel")} aria-hidden="true">
        {Array.from({ length: METER_BARS }, (_, index) => (
          <span key={index} className={`voice-level-bar${index < activeBars ? " is-lit" : ""}`} />
        ))}
      </div>

      <span className="voice-call-model text-muted" title={t("voiceCallBar.voiceRepliesComeFrom", { modelName: modelName })}>
        {modelName}
      </span>

      {error ? (
        permissionDenied ? (
          <span className="voice-call-error voice-call-perm-error">
            <span title={error}>{error}</span>
            <button
              className="btn btn-sm voice-call-perm-fix"
              type="button"
              title={t("voiceCallBar.resetTheMicPermissionSo")}
              onClick={onResetMicPermission}
            >
              {t("voiceCallBar.resetMicPermission")}
            </button>
            <button
              className="btn btn-sm voice-call-perm-alt"
              type="button"
              title={t("voiceCallBar.openTheWindowsMicrophonePrivacy")}
              onClick={onOpenMicSettings}
            >
              {t("voiceCallBar.windowsSettings")}
            </button>
          </span>
        ) : (
          <span className="voice-call-error" title={error}>
            {error}
          </span>
        )
      ) : null}

      <div className="voice-call-actions">
        {callActive ? (
          <>
            <button
              className="btn btn-sm"
              type="button"
              title={muted ? t("voiceCallBar.unmuteTheMicrophone") : t("voiceCallBar.muteTheMicrophoneWithoutEnding")}
              aria-pressed={muted}
              onClick={onToggleMute}
            >
              {muted ? <MicOff size={13} /> : <Mic size={13} />}
            </button>
            <button
              className="btn btn-sm"
              type="button"
              title={t("voiceCallBar.voiceSettingsProviderModelSpeech")}
              onClick={onOpenSettings}
            >
              <Settings2 size={13} />
            </button>
          </>
        ) : null}
        <button
          className="btn btn-sm voice-call-end"
          type="button"
          title={callActive ? t("voiceCallBar.endTheVoiceCallAnd") : t("voiceCallBar.dismissThisMessage")}
          onClick={onEnd}
        >
          {callActive ? <PhoneOff size={13} /> : <X size={13} />}
          <span>{callActive ? t("voiceCallBar.end") : t("voiceCallBar.dismiss")}</span>
        </button>
      </div>

      {profile && !profile.ttsEnabled ? (
        <span className="text-muted text-sm" title={t("voiceCallBar.repliesAreTranscribedToThe")}>
          {t("voiceCallBar.readbackOff")}
        </span>
      ) : null}
    </div>
  );
}
