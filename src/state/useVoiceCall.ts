import { useCallback, useEffect, useRef, useState } from "react";
import { voiceTranscribe, type VoiceProfile } from "../lib/voice";

/**
 * Voice call runtime for the chat composer.
 *
 * WebView2 ships `speechSynthesis` (so TTS is native and free) but NOT
 * `SpeechRecognition`, which is a Chrome feature backed by Google servers.
 * Speech-to-text therefore has to leave the webview: we capture Opus in the
 * renderer and hand the bytes to the Rust `voice_transcribe` command, which
 * owns the credential and the engine choice.
 *
 * Two capture modes share one pipeline:
 *   push-to-talk: the button owns the utterance boundary.
 *   call: an energy gate owns it, so the user never touches the keyboard.
 */

/** Where the call is in the listen, transcribe, answer, speak cycle. */
export type VoiceState = "off" | "idle" | "capturing" | "transcribing" | "speaking";

export type VoiceSupport = {
  mic: boolean;
  tts: boolean;
  /** Plain-language reason the unsupported half is unsupported. */
  reason: string | null;
};

/**
 * Absolute noise gate. Anything quieter than this is treated as room tone no
 * matter how quiet the room is, which stops a silent mic from transcribing
 * its own noise floor forever.
 */
const SPEECH_FLOOR = 0.012;
/**
 * Speech must clear the measured noise floor by this factor. Adaptive so a
 * noisy room raises the bar instead of triggering constantly.
 */
const SPEECH_MARGIN = 2.8;
/**
 * While TTS is playing the bar is higher still. Browser echo cancellation
 * already removes most of our own output, this covers the rest so the agent
 * does not interrupt itself.
 */
const BARGE_IN_MARGIN = 4.5;
/** Utterances shorter than this are coughs, clicks and door slams. */
const MIN_UTTERANCE_MS = 320;
/** Energy is sampled on a timer, not rAF: a backgrounded window must keep listening. */
const VAD_TICK_MS = 50;

/** The first Opus container MediaRecorder admits to supporting. */
function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "audio/webm";
}

/** Strip the container parameters so the backend sees an allowlisted type. */
function baseMime(mime: string): string {
  return mime.split(";")[0] ?? "audio/webm";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunked so a long utterance cannot blow the argument limit on spread.
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export type UseVoiceCallOptions = {
  profile: VoiceProfile | null;
  /** Receives a final transcript. The caller decides whether to send or steer. */
  onTranscript: (text: string) => void | Promise<void>;
  addLog: (level: "debug" | "info" | "warn" | "error", title: string, detail?: string) => void;
};

export function useVoiceCall({ profile, onTranscript, addLog }: UseVoiceCallOptions) {
  const [state, setState] = useState<VoiceState>("off");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [support, setSupport] = useState<VoiceSupport>({ mic: true, tts: true, reason: null });
  const [muted, setMuted] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);
  const noiseFloorRef = useRef(SPEECH_FLOOR);
  const speechStartedAtRef = useRef(0);
  const lastSpeechAtRef = useRef(0);
  const silenceSinceRef = useRef(0);
  const stateRef = useRef<VoiceState>("off");
  const callActiveRef = useRef(false);
  const profileRef = useRef(profile);
  const onTranscriptRef = useRef(onTranscript);

  profileRef.current = profile;
  onTranscriptRef.current = onTranscript;
  // The ref is authoritative so the VAD timer never reads a stale closure;
  // the state value exists purely to re-render the button.
  const mutedRef = useRef(false);

  const setPhase = useCallback((next: VoiceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Capability probe. Both halves degrade independently: a machine with no
  // microphone can still hear replies, and a machine with no speech voices can
  // still dictate.
  useEffect(() => {
    const mic = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
    const tts = typeof window !== "undefined" && "speechSynthesis" in window;
    let reason: string | null = null;
    if (!mic && !tts) reason = "This build has no microphone or speech synthesis access.";
    else if (!mic) reason = "No microphone access in this webview, so dictation is unavailable.";
    else if (!tts) reason = "No speech synthesis voices installed, so replies will not be read aloud.";
    setSupport({ mic, tts, reason });
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    if (stateRef.current === "speaking") setPhase(callActiveRef.current ? "idle" : "off");
  }, [setPhase]);

  const speak = useCallback(
    (text: string) => {
      const active = profileRef.current;
      if (!active?.ttsEnabled || !text.trim()) return;
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = active.ttsRate || 1;
      if (active.ttsVoice) {
        const match = synth.getVoices().find((voice) => voice.name === active.ttsVoice);
        if (match) utterance.voice = match;
      }
      utterance.onend = () => {
        if (stateRef.current === "speaking") setPhase(callActiveRef.current ? "idle" : "off");
      };
      utterance.onerror = () => {
        if (stateRef.current === "speaking") setPhase(callActiveRef.current ? "idle" : "off");
      };
      setPhase("speaking");
      synth.speak(utterance);
    },
    [setPhase],
  );

  const transcribe = useCallback(async () => {
    const active = profileRef.current;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    if (!active || chunks.length === 0) {
      setPhase(callActiveRef.current ? "idle" : "off");
      return;
    }
    const mime = recorderRef.current?.mimeType || pickMimeType();
    const blob = new Blob(chunks, { type: mime });
    if (blob.size < 1024) {
      // Too small to contain speech. Silently return to listening rather than
      // billing a transcription request for a click.
      setPhase(callActiveRef.current ? "idle" : "off");
      return;
    }
    setPhase("transcribing");
    try {
      const audioBase64 = await blobToBase64(blob);
      const result = await voiceTranscribe({
        audioBase64,
        mimeType: baseMime(mime),
        engine: active.sttEngine,
        providerId: active.sttProviderId,
        modelId: active.sttModelId,
        languageHint: null,
      });
      const text = result.text.trim();
      addLog("debug", "Voice transcript", `engine=${result.engine} chars=${text.length} ms=${result.durationMs}`);
      if (text) await onTranscriptRef.current(text);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      addLog("error", "Voice transcription failed", message);
    } finally {
      setPhase(callActiveRef.current ? "idle" : "off");
    }
  }, [addLog, setPhase]);

  const startRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || recorderRef.current?.state === "recording") return;
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => void transcribe();
    recorderRef.current = recorder;
    recorder.start();
    setPhase("capturing");
    speechStartedAtRef.current = Date.now();
    lastSpeechAtRef.current = Date.now();
  }, [setPhase, transcribe]);

  const stopRecorder = useCallback((discard: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    if (discard) {
      recorder.onstop = null;
      chunksRef.current = [];
      recorder.stop();
      setPhase(callActiveRef.current ? "idle" : "off");
      return;
    }
    recorder.stop();
  }, [setPhase]);

  /** One energy sample: adapt the floor, then run the capture state machine. */
  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    if (mutedRef.current) {
      // Muted means deaf, not just quiet: drop any partial utterance so
      // unmuting cannot send half a sentence recorded before the mute.
      if (stateRef.current === "capturing") stopRecorder(true);
      setLevel(0);
      return;
    }
    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
    const rms = Math.sqrt(sum / buffer.length);
    setLevel(rms);

    const phase = stateRef.current;
    const speaking = phase === "speaking";
    const margin = speaking ? BARGE_IN_MARGIN : SPEECH_MARGIN;
    const threshold = Math.max(SPEECH_FLOOR, noiseFloorRef.current * margin);
    const isSpeech = rms > threshold;

    // Track the floor only while nobody is talking, so speech never raises the
    // bar against itself.
    if (!isSpeech) {
      noiseFloorRef.current = noiseFloorRef.current * 0.95 + rms * 0.05;
    }

    const profileNow = profileRef.current;
    if (phase === "idle" && isSpeech) {
      startRecorder();
      silenceSinceRef.current = 0;
      return;
    }
    if (speaking && isSpeech && profileNow?.bargeIn) {
      // The user talked over the agent. Cut the audio and capture what they say
      // next; the caller routes it into the running turn as a steer.
      addLog("debug", "Voice barge-in", "user speech detected during playback");
      stopSpeaking();
      startRecorder();
      silenceSinceRef.current = 0;
      return;
    }
    if (phase === "capturing") {
      if (isSpeech) {
        silenceSinceRef.current = 0;
        lastSpeechAtRef.current = Date.now();
        return;
      }
      const now = Date.now();
      if (silenceSinceRef.current === 0) {
        silenceSinceRef.current = now;
        return;
      }
      const spokenMs = lastSpeechAtRef.current - speechStartedAtRef.current;
      const silenceMs = now - silenceSinceRef.current;
      const limit = profileNow?.vadSilenceMs ?? 900;
      if (silenceMs >= limit) {
        silenceSinceRef.current = 0;
        if (spokenMs < MIN_UTTERANCE_MS) stopRecorder(true);
        else stopRecorder(false);
      }
    }
  }, [addLog, startRecorder, stopRecorder, stopSpeaking]);

  /** Open the microphone once and hang the analyser off it. */
  const openMic = useCallback(async (): Promise<boolean> => {
    if (streamRef.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Non-negotiable for call mode: without echo cancellation the mic
          // hears our own TTS and the agent interrupts itself in a loop.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      // WebView2 and modern WKWebView both expose the unprefixed constructor,
      // so there is no vendor fallback to maintain here.
      const AudioCtor = window.AudioContext;
      if (AudioCtor) {
        const ctx = new AudioCtor();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        // A fresh AudioContext starts suspended; without resuming it the
        // analyser reads silence forever, so the VAD never fires.
        void ctx.resume();
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        noiseFloorRef.current = SPEECH_FLOOR;
      }
      setError(null);
      setPermissionDenied(false);
      return true;
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setPermissionDenied(true);
        setError("Microphone access was blocked. Click the button to open settings and re-enable it.");
        addLog("warn", "Microphone permission denied", name);
      } else {
        setPermissionDenied(false);
        const message = err instanceof Error ? err.message : String(err);
        setError(`Microphone unavailable: ${message}`);
        addLog("error", "Microphone access denied", message);
      }
      return false;
    }
  }, [addLog]);

  /** Release the microphone. A hot mic left open is a privacy bug, not a perf one. */
  const closeMic = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
    analyserRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLevel(0);
  }, []);

  const startCall = useCallback(async () => {
    if (callActiveRef.current) return;
    addLog("debug", "Voice call start", `mode=${profileRef.current?.mode ?? "call"}`);
    if (!(await openMic())) return;
    callActiveRef.current = true;
    setCallActive(true);
    setPhase("idle");
    silenceSinceRef.current = 0;
    if (tickRef.current === null) {
      tickRef.current = window.setInterval(tick, VAD_TICK_MS);
    }
  }, [addLog, openMic, setPhase, tick]);

  const endCall = useCallback(() => {
    addLog("debug", "Voice call end");
    callActiveRef.current = false;
    setCallActive(false);
    stopSpeaking();
    stopRecorder(true);
    closeMic();
    setPhase("off");
  }, [addLog, closeMic, setPhase, stopRecorder, stopSpeaking]);

  const beginPushToTalk = useCallback(async () => {
    if (stateRef.current === "capturing") return;
    addLog("debug", "Push to talk begin");
    stopSpeaking();
    if (!(await openMic())) return;
    startRecorder();
  }, [addLog, openMic, startRecorder, stopSpeaking]);

  const endPushToTalk = useCallback(() => {
    if (stateRef.current !== "capturing") return;
    addLog("debug", "Push to talk end");
    const spokenMs = Date.now() - speechStartedAtRef.current;
    stopRecorder(spokenMs < MIN_UTTERANCE_MS);
    // A one-shot press does not keep the microphone open.
    if (!callActiveRef.current) {
      window.setTimeout(() => {
        if (!callActiveRef.current) closeMic();
      }, 0);
    }
  }, [addLog, closeMic, stopRecorder]);

  // Unmount must release the device even if the user never ended the call.
  useEffect(() => () => {
    callActiveRef.current = false;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    closeMic();
  }, [closeMic]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    setMuted(next);
    addLog("debug", "Voice mute toggled", `muted=${next}`);
    if (next && stateRef.current === "capturing") stopRecorder(true);
  }, [addLog, stopRecorder]);

  return {
    state,
    level,
    error,
    permissionDenied,
    support,
    callActive,
    muted,
    toggleMute,
    startCall,
    endCall,
    beginPushToTalk,
    endPushToTalk,
    speak,
    stopSpeaking,
  };
}
