import { invoke } from "@tauri-apps/api/core";

// ─── Types ───
//
// Mirrors `src-tauri/src/models/voice.rs` field for field. The webview has
// `speechSynthesis` but no `SpeechRecognition`, so speech to text round-trips
// through Rust and this is the wire shape for that round trip.

/** Engines available for speech to text. */
export type SttEngine =
  | "openai_whisper"
  | "windows_native"
  | "local_whisper";

export type VoiceMode = "push_to_talk" | "call";

export type VoiceProfile = {
  enabled: boolean;
  /** Chat provider/model for VOICE conversations, independent of text chat. */
  providerId: string;
  modelId: string;
  effortLevel: string;
  sttEngine: SttEngine;
  /** Credential provider for STT, separate from `providerId`. */
  sttProviderId: string;
  sttModelId: string;
  ttsEnabled: boolean;
  /** `speechSynthesis` voice name. `null` = the OS default voice. */
  ttsVoice: string | null;
  ttsRate: number;
  mode: VoiceMode;
  /** Trailing silence that ends an utterance in Call mode. */
  vadSilenceMs: number;
  /** Speaking over the agent interrupts it. */
  bargeIn: boolean;
};

export type VoiceTranscribeRequest = {
  /** Raw standard base64. No `data:` URL prefix. */
  audioBase64: string;
  mimeType: string;
  engine: SttEngine;
  providerId: string;
  modelId: string;
  languageHint: string | null;
};

export type VoiceTranscribeResult = {
  text: string;
  engine: string;
  durationMs: number;
};

// ─── Commands ───

export async function voiceProfileGet(): Promise<VoiceProfile> {
  return invoke<VoiceProfile>("voice_profile_get");
}

/** Returns the profile as actually stored, with any clamped values applied. */
export async function voiceProfileSet(profile: VoiceProfile): Promise<VoiceProfile> {
  return invoke<VoiceProfile>("voice_profile_set", { profile });
}

export async function voiceTranscribe(
  request: VoiceTranscribeRequest,
): Promise<VoiceTranscribeResult> {
  return invoke<VoiceTranscribeResult>("voice_transcribe", { request });
}
