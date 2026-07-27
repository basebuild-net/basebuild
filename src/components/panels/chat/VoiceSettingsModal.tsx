import { useEffect, useMemo, useState } from "react";
import { ModalPortal } from "../../ModalPortal";
import { OptionList } from "../../layout/OptionList";
import { useEscapeKey } from "../../../lib/useEscapeKey";
import type { NativeProviderCatalog } from "../../../lib/native-chat";
import {
  toolCatalogList,
  toolDownloadsList,
  toolDownload,
  toolDownloadDelete,
  type CatalogTool,
  type DownloadedToolModel,
} from "../../../lib/toolCatalog";
import type { SttEngine, VoiceMode, VoiceProfile } from "../../../lib/voice";

/**
 * Voice preferences, kept deliberately separate from the composer's model
 * selection. Talking and typing want different models: dictation rewards a
 * fast conversational one, typed work often wants the slow careful one.
 */

const ENGINE_OPTIONS: { id: SttEngine; label: string; title: string }[] = [
  {
    id: "openai_whisper",
    label: "OpenAI",
    title: "Send captured audio to OpenAI for transcription. Needs an OpenAI API key and bills per minute.",
  },
  {
    id: "windows_native",
    label: "Windows",
    title: "Windows built-in speech recognition. Offline and free, not wired up yet.",
  },
  {
    id: "local_whisper",
    label: "Local Whisper",
    title: "Whisper running on this machine. Offline and free, not wired up yet.",
  },
  {
    id: "parakeet_unified_en",
    label: "Parakeet EN",
    title: "Offline English transcription via transcribe.cpp. Download a model below, then speak.",
  },
  {
    id: "parakeet_tdt_v3",
    label: "Parakeet V3",
    title: "Offline multilingual transcription (25 European languages) via transcribe.cpp. Download a model below.",
  },
];

const MODE_OPTIONS: { id: VoiceMode; label: string; title: string }[] = [
  {
    id: "call",
    label: "Call",
    title: "Continuous listening. Speak whenever you like, including over the agent to interrupt it.",
  },
  {
    id: "push_to_talk",
    label: "Push to talk",
    title: "The microphone is open only while you hold the button.",
  },
];

const EFFORT_OPTIONS = [
  { id: "low", label: "Low", title: "Fastest replies, least deliberation" },
  { id: "medium", label: "Medium", title: "Balanced speed and reasoning" },
  { id: "high", label: "High", title: "Slowest and most thorough" },
];

export type VoiceSettingsModalProps = {
  profile: VoiceProfile;
  catalog: NativeProviderCatalog | null;
  onSave: (profile: VoiceProfile) => void;
  onClose: () => void;
};

export function VoiceSettingsModal({ profile, catalog, onSave, onClose }: VoiceSettingsModalProps) {
  const [draft, setDraft] = useState<VoiceProfile>(profile);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEscapeKey(true, onClose);

  // Installed speech voices arrive asynchronously on first access, so listen
  // for the change event as well as reading once.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const read = () => setVoices(window.speechSynthesis.getVoices());
    read();
    window.speechSynthesis.addEventListener("voiceschanged", read);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", read);
  }, []);

  // Offline STT tool catalog and download state. Loaded once when the modal
  // opens; the download list is refreshed after each download/delete.
  const [sttTools, setSttTools] = useState<CatalogTool[]>([]);
  const [downloads, setDownloads] = useState<DownloadedToolModel[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const refreshDownloads = () => {
    void toolDownloadsList().then(setDownloads).catch(() => {});
  };

  useEffect(() => {
    void toolCatalogList("speechToText")
      .then(setSttTools)
      .catch(() => setSttTools([]));
    refreshDownloads();
  }, []);

  const isParakeetEngine =
    draft.sttEngine === "parakeet_tdt_v3" || draft.sttEngine === "parakeet_unified_en";

  const selectedToolId =
    draft.sttEngine === "parakeet_tdt_v3"
      ? "parakeet-tdt-0.6b-v3"
      : draft.sttEngine === "parakeet_unified_en"
        ? "parakeet-unified-en-0.6b"
        : null;

  const selectedTool = sttTools.find((t) => t.id === selectedToolId) ?? null;

  const handleDownload = (toolId: string, quant: string) => {
    setDownloading(`${toolId}:${quant}`);
    setDownloadError(null);
    void toolDownload("speechToText", toolId, quant)
      .then(() => {
        refreshDownloads();
      })
      .catch((error: unknown) => {
        setDownloadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setDownloading(null));
  };

  const handleDelete = (toolId: string, quant: string) => {
    setDownloading(`${toolId}:${quant}:delete`);
    setDownloadError(null);
    void toolDownloadDelete(toolId, quant)
      .then(() => {
        refreshDownloads();
      })
      .catch((error: unknown) => {
        setDownloadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setDownloading(null));
  };

  const providers = useMemo(
    () => (catalog?.providers ?? []).filter((provider) => provider.configured),
    [catalog],
  );
  const models = useMemo(
    () => (catalog?.models ?? []).filter((model) => model.providerId === draft.providerId),
    [catalog, draft.providerId],
  );

  const patch = (next: Partial<VoiceProfile>) => setDraft((current) => ({ ...current, ...next }));

  return (
    <ModalPortal>
      <div className="modal-backdrop" onClick={onClose} role="presentation">
        <div
          className="modal voice-settings-modal"
          role="dialog"
          aria-label="Voice settings"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="modal-header">
            <h2>Voice</h2>
            <button className="btn btn-sm" type="button" title="Close voice settings" onClick={onClose}>
              Close
            </button>
          </header>

          <div className="modal-body voice-settings-body">
            <p className="text-muted text-sm">
              You can hold a voice conversation with any text model: speech is transcribed on the way in and read
              aloud on the way out. Models badged Realtime in the catalog are a different thing, a single duplex
              audio stream, and every vendor bills those through an API key rather than a subscription.
            </p>

            <section className="voice-settings-section">
              <h3 title="Which model answers when you speak">Conversation</h3>
              <label className="voice-settings-field">
                <span>Provider</span>
                <select
                  className="input"
                  value={draft.providerId}
                  title="Provider used for voice conversations, independent of the composer's selection"
                  onChange={(event) => patch({ providerId: event.target.value, modelId: "" })}
                >
                  <option value="">Use the composer's current provider</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="voice-settings-field">
                <span>Model</span>
                <select
                  className="input"
                  value={draft.modelId}
                  disabled={!draft.providerId}
                  title="Model used for voice conversations"
                  onChange={(event) => patch({ modelId: event.target.value })}
                >
                  <option value="">Use the composer's current model</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                      {model.voice?.level === "realtime" ? " (realtime)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="voice-settings-field">
                <span>Effort</span>
                <OptionList
                  compact
                  label="Voice reasoning effort"
                  value={draft.effortLevel}
                  options={EFFORT_OPTIONS}
                  onChange={(id) => patch({ effortLevel: id })}
                />
              </div>
            </section>

            <section className="voice-settings-section">
              <h3 title="How your speech becomes text">Speech to text</h3>
              <div className="voice-settings-field">
                <span>Engine</span>
                <OptionList
                  compact
                  label="Speech to text engine"
                  value={draft.sttEngine}
                  options={ENGINE_OPTIONS}
                  onChange={(id) => patch({ sttEngine: id })}
                />
              </div>
              {draft.sttEngine === "openai_whisper" ? (
                <label className="voice-settings-field">
                  <span>Transcription model</span>
                  <input
                    className="input"
                    value={draft.sttModelId}
                    title="OpenAI transcription model, for example whisper-1 or gpt-4o-transcribe"
                    onChange={(event) => patch({ sttModelId: event.target.value })}
                  />
                </label>
              ) : isParakeetEngine && selectedTool ? (
                <div className="voice-stt-downloads">
                  <p className="text-sm">
                    {selectedTool.description}
                  </p>
                  <p className="text-muted text-sm">
                    Languages: {selectedTool.languages.length > 0
                      ? selectedTool.languages.join(", ")
                      : "language-agnostic"}
                    {" \u00b7 "}
                    License: {selectedTool.license}
                  </p>
                  {downloadError ? (
                    <p className="voice-stt-error text-sm">
                      {downloadError}
                    </p>
                  ) : null}
                  <div className="voice-stt-file-list">
                    {selectedTool.files.map((file) => {
                      const isDownloaded = downloads.some(
                        (d) => d.toolId === selectedTool.id && d.quant === file.quant,
                      );
                      const isDownloading =
                        downloading === `${selectedTool.id}:${file.quant}`;
                      const isDeleting =
                        downloading === `${selectedTool.id}:${file.quant}:delete`;
                      const isDefault = file.quant === selectedTool.defaultQuant;
                      return (
                        <div
                          key={file.quant}
                          className="voice-stt-file-row"
                          title={`${file.quant} \u00b7 ${(file.sizeBytes / 1024 / 1024).toFixed(0)} MB`}
                        >
                          <span className="voice-stt-file-label">
                            {file.quant}
                            {isDefault ? " (recommended)" : ""}
                            {" \u00b7 "}
                            {(file.sizeBytes / 1024 / 1024).toFixed(0)} MB
                          </span>
                          {isDownloaded ? (
                            <button
                              className="btn btn-sm"
                              type="button"
                              title="Remove the downloaded model file from disk"
                              disabled={isDeleting}
                              onClick={() => handleDelete(selectedTool.id, file.quant)}
                            >
                              {isDeleting ? "Removing..." : "Remove"}
                            </button>
                          ) : (
                            <button
                              className="btn btn-sm btn-primary"
                              type="button"
                              title={`Download ${file.quant} (${(file.sizeBytes / 1024 / 1024).toFixed(0)} MB)`}
                              disabled={isDownloading}
                              onClick={() => handleDownload(selectedTool.id, file.quant)}
                            >
                              {isDownloading ? "Downloading..." : "Download"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-muted text-sm">
                    Requires transcribe-cli in PATH. Install from
                    {" "}
                    <a
                      href="https://github.com/handy-computer/transcribe.cpp"
                      target="_blank"
                      rel="noreferrer"
                    >
                      transcribe.cpp
                    </a>
                    .
                  </p>
                </div>
              ) : (
                <p className="text-muted text-sm">
                  This engine is not wired up yet. Dictation will report that clearly rather than sending silence.
                </p>
              )}
            </section>

            <section className="voice-settings-section">
              <h3 title="Whether replies are read back to you">Reply readback</h3>
              <div className="voice-settings-field">
                <span>Read replies aloud</span>
                <OptionList
                  compact
                  label="Read replies aloud"
                  value={draft.ttsEnabled ? "on" : "off"}
                  options={[
                    { id: "on", label: "On", title: "Speak each reply using an installed system voice" },
                    { id: "off", label: "Off", title: "Show replies on screen only" },
                  ]}
                  onChange={(id) => patch({ ttsEnabled: id === "on" })}
                />
              </div>
              {draft.ttsEnabled ? (
                <>
                  <label className="voice-settings-field">
                    <span>Voice</span>
                    <select
                      className="input"
                      value={draft.ttsVoice ?? ""}
                      title="System voice used to read replies aloud"
                      onChange={(event) => patch({ ttsVoice: event.target.value || null })}
                    >
                      <option value="">System default</option>
                      {voices.map((voice) => (
                        <option key={voice.name} value={voice.name}>
                          {voice.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="voice-settings-field">
                    <span>Rate</span>
                    <input
                      className="input"
                      type="range"
                      min={0.6}
                      max={2}
                      step={0.1}
                      value={draft.ttsRate}
                      title={`Speech rate: ${draft.ttsRate.toFixed(1)}x`}
                      onChange={(event) => patch({ ttsRate: Number(event.target.value) })}
                    />
                  </label>
                </>
              ) : null}
            </section>

            <section className="voice-settings-section">
              <h3 title="How the call decides you have finished speaking">Call behaviour</h3>
              <div className="voice-settings-field">
                <span>Default mode</span>
                <OptionList
                  compact
                  label="Default voice mode"
                  value={draft.mode}
                  options={MODE_OPTIONS}
                  onChange={(id) => patch({ mode: id })}
                />
              </div>
              <label className="voice-settings-field">
                <span>End of speech silence</span>
                <input
                  className="input"
                  type="number"
                  min={300}
                  max={4000}
                  step={100}
                  value={draft.vadSilenceMs}
                  title="How long you must pause before the utterance is sent, in milliseconds"
                  onChange={(event) => patch({ vadSilenceMs: Number(event.target.value) })}
                />
              </label>
              <div className="voice-settings-field">
                <span>Interrupt by speaking</span>
                <OptionList
                  compact
                  label="Interrupt by speaking"
                  value={draft.bargeIn ? "on" : "off"}
                  options={[
                    { id: "on", label: "On", title: "Talking over a reply stops it and steers the running turn" },
                    { id: "off", label: "Off", title: "Let each reply finish before listening again" },
                  ]}
                  onChange={(id) => patch({ bargeIn: id === "on" })}
                />
              </div>
            </section>
          </div>

          <footer className="modal-footer">
            <button className="btn" type="button" title="Discard changes and close" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              type="button"
              title="Save these voice preferences"
              onClick={() => onSave(draft)}
            >
              Save
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  );
}
