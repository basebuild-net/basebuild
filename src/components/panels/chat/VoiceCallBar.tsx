import { Loader2, Mic, MicOff, PhoneOff, Settings2, Volume2, X } from "lucide-react";
import type { VoiceProfile } from "../../../lib/voice";
import type { VoiceState } from "../../../state/useVoiceCall";

/**
 * The in-call strip above the composer. It answers one question at a glance:
 * is the microphone hearing me right now, or is something else happening?
 */

const STATE_LABELS: Record<VoiceState, string> = {
  off: "Call ended",
  idle: "Listening",
  capturing: "Hearing you",
  transcribing: "Transcribing",
  speaking: "Speaking",
};

const STATE_TITLES: Record<VoiceState, string> = {
  off: "The call is not active",
  idle: "Waiting for you to speak. Just start talking.",
  capturing: "Capturing your speech. It sends when you stop talking.",
  transcribing: "Converting your speech to text",
  speaking: "Reading the reply aloud. Talk over it to interrupt.",
};

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
  onEnd,
  onOpenSettings,
  onOpenMicSettings,
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
        <span className="voice-call-state" title={muted ? "Microphone muted. The agent cannot hear you." : STATE_TITLES[state]}>
          {muted ? "Muted" : STATE_LABELS[state]}
        </span>
      </div>

      <div className="voice-level" title="Microphone input level" aria-hidden="true">
        {Array.from({ length: METER_BARS }, (_, index) => (
          <span key={index} className={`voice-level-bar${index < activeBars ? " is-lit" : ""}`} />
        ))}
      </div>

      <span className="voice-call-model text-muted" title={`Voice replies come from ${modelName}`}>
        {modelName}
      </span>

      {error ? (
        permissionDenied ? (
          <span className="voice-call-error voice-call-perm-error">
            <span title={error}>{error}</span>
            <button
              className="btn btn-sm voice-call-perm-fix"
              type="button"
              title="Open the microphone privacy settings so you can re-enable access for this app"
              onClick={onOpenMicSettings}
            >
              Open mic settings
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
              title={muted ? "Unmute the microphone" : "Mute the microphone without ending the call"}
              aria-pressed={muted}
              onClick={onToggleMute}
            >
              {muted ? <MicOff size={13} /> : <Mic size={13} />}
            </button>
            <button
              className="btn btn-sm"
              type="button"
              title="Voice settings: provider, model, speech engine and reply voice"
              onClick={onOpenSettings}
            >
              <Settings2 size={13} />
            </button>
          </>
        ) : null}
        <button
          className="btn btn-sm voice-call-end"
          type="button"
          title={callActive ? "End the voice call and release the microphone" : "Dismiss this message"}
          onClick={onEnd}
        >
          {callActive ? <PhoneOff size={13} /> : <X size={13} />}
          <span>{callActive ? "End" : "Dismiss"}</span>
        </button>
      </div>

      {profile && !profile.ttsEnabled ? (
        <span className="text-muted text-sm" title="Replies are transcribed to the chat but not read aloud">
          Readback off
        </span>
      ) : null}
    </div>
  );
}
