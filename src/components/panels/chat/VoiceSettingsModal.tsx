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
import { t } from "../../../i18n";

/**
 * Voice preferences, kept deliberately separate from the composer's model
 * selection. Talking and typing want different models: dictation rewards a
 * fast conversational one, typed work often wants the slow careful one.
 */

const ENGINE_OPTIONS = (): { id: SttEngine; label: string; title: string }[] => [
  {
    id: "openai_whisper",
    label: t("voiceSettingsModal.openai"),
    title: t("voiceSettingsModal.sendCapturedAudioToOpenaiFor"),
  },
  {
    id: "windows_native",
    label: t("voiceSettingsModal.windows"),
    title: t("voiceSettingsModal.windowsBuiltInSpeechRecognitionOffline"),
  },
  {
    id: "local_whisper",
    label: t("voiceSettingsModal.localWhisper"),
    title: t("voiceSettingsModal.whisperRunningOnThisMachineOffline"),
  },
  {
    id: "parakeet_unified_en",
    label: t("voiceSettingsModal.parakeetEn"),
    title: t("voiceSettingsModal.offlineEnglishTranscriptionViaTranscribeCpp"),
  },
  {
    id: "parakeet_tdt_v3",
    label: t("voiceSettingsModal.parakeetV3"),
    title: t("voiceSettingsModal.offlineMultilingualTranscription25EuropeanLanguages"),
  },
];

const MODE_OPTIONS = (): { id: VoiceMode; label: string; title: string }[] => [
  {
    id: "call",
    label: t("voiceSettingsModal.call"),
    title: t("voiceSettingsModal.continuousListeningSpeakWheneverYouLike"),
  },
  {
    id: "push_to_talk",
    label: t("voiceSettingsModal.pushToTalk"),
    title: t("voiceSettingsModal.theMicrophoneIsOpenOnlyWhile"),
  },
];

const EFFORT_OPTIONS = () => [
  { id: "low", label: t("voiceSettingsModal.low"), title: t("voiceSettingsModal.fastestRepliesLeastDeliberation") },
  { id: "medium", label: t("voiceSettingsModal.medium"), title: t("voiceSettingsModal.balancedSpeedAndReasoning") },
  { id: "high", label: t("voiceSettingsModal.high"), title: t("voiceSettingsModal.slowestAndMostThorough") },
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
          aria-label={t("voiceSettingsModal.voiceSettings")}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="modal-header">
            <h2>{t("voiceSettingsModal.voice")}</h2>
            <button className="btn btn-sm" type="button" title={t("voiceSettingsModal.closeVoiceSettings")} onClick={onClose}>
              {t("voiceSettingsModal.close")}
            </button>
          </header>

          <div className="modal-body voice-settings-body">
            <p className="text-muted text-sm">
              {t("voiceSettingsModal.youCanHoldAVoice")}
            </p>

            <section className="voice-settings-section">
              <h3 title={t("voiceSettingsModal.whichModelAnswersWhenYou")}>{t("voiceSettingsModal.conversation")}</h3>
              <label className="voice-settings-field">
                <span>{t("voiceSettingsModal.provider")}</span>
                <select
                  className="input"
                  value={draft.providerId}
                  title={t("voiceSettingsModal.providerUsedForVoiceConversations")}
                  onChange={(event) => patch({ providerId: event.target.value, modelId: "" })}
                >
                  <option value="">{t("voiceSettingsModal.useTheComposerSCurrent")}</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="voice-settings-field">
                <span>{t("voiceSettingsModal.model")}</span>
                <select
                  className="input"
                  value={draft.modelId}
                  disabled={!draft.providerId}
                  title={t("voiceSettingsModal.modelUsedForVoiceConversations")}
                  onChange={(event) => patch({ modelId: event.target.value })}
                >
                  <option value="">{t("voiceSettingsModal.useTheComposerSCurrent2")}</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                      {model.voice?.level === "realtime" ? t("voiceSettingsModal.realtime") : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="voice-settings-field">
                <span>{t("voiceSettingsModal.effort")}</span>
                <OptionList
                  compact
                  label={t("voiceSettingsModal.voiceReasoningEffort")}
                  value={draft.effortLevel}
                  options={EFFORT_OPTIONS()}
                  onChange={(id) => patch({ effortLevel: id })}
                />
              </div>
            </section>

            <section className="voice-settings-section">
              <h3 title={t("voiceSettingsModal.howYourSpeechBecomesText")}>{t("voiceSettingsModal.speechToText")}</h3>
              <div className="voice-settings-field">
                <span>{t("voiceSettingsModal.engine")}</span>
                <OptionList
                  compact
                  label={t("voiceSettingsModal.speechToTextEngine")}
                  value={draft.sttEngine}
                  options={ENGINE_OPTIONS()}
                  onChange={(id) => patch({ sttEngine: id })}
                />
              </div>
              {draft.sttEngine === "openai_whisper" ? (
                <label className="voice-settings-field">
                  <span>{t("voiceSettingsModal.transcriptionModel")}</span>
                  <input
                    className="input"
                    value={draft.sttModelId}
                    title={t("voiceSettingsModal.openAITranscriptionModelForExample")}
                    onChange={(event) => patch({ sttModelId: event.target.value })}
                  />
                </label>
              ) : isParakeetEngine && selectedTool ? (
                <div className="voice-stt-downloads">
                  <p className="text-sm">
                    {selectedTool.description}
                  </p>
                  <p className="text-muted text-sm">
                    {t("voiceSettingsModal.languagesAndLicense", { languages: selectedTool.languages.length > 0 ? selectedTool.languages.join(", ") : t("voiceSettingsModal.languageAgnostic"), license: selectedTool.license })}
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
                          title={t("voiceSettingsModal.mB", { quant: file.quant, value: (file.sizeBytes / 1024 / 1024).toFixed(0) })}
                        >
                          <span className="voice-stt-file-label">
                            {file.quant}
                            {isDefault ? t("voiceSettingsModal.recommended") : ""}
                            {" \u00b7 "}
                            {(file.sizeBytes / 1024 / 1024).toFixed(0)} MB
                          </span>
                          {isDownloaded ? (
                            <button
                              className="btn btn-sm"
                              type="button"
                              title={t("voiceSettingsModal.removeTheDownloadedModelFile")}
                              disabled={isDeleting}
                              onClick={() => handleDelete(selectedTool.id, file.quant)}
                            >
                              {isDeleting ? t("voiceSettingsModal.removing") : t("voiceSettingsModal.remove")}
                            </button>
                          ) : (
                            <button
                              className="btn btn-sm btn-primary"
                              type="button"
                              title={t("voiceSettingsModal.downloadMB", { quant: file.quant, value: (file.sizeBytes / 1024 / 1024).toFixed(0) })}
                              disabled={isDownloading}
                              onClick={() => handleDownload(selectedTool.id, file.quant)}
                            >
                              {isDownloading ? t("voiceSettingsModal.downloading") : t("voiceSettingsModal.download")}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-muted text-sm">
                    {t("voiceSettingsModal.requiresTranscribeCliInPath")}<a
                      href="https://github.com/handy-computer/transcribe.cpp"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("voiceSettingsModal.transcribeCpp")}
                    </a>
                    .
                  </p>
                </div>
              ) : (
                <p className="text-muted text-sm">
                  {t("voiceSettingsModal.thisEngineIsNotWired")}
                </p>
              )}
            </section>

            <section className="voice-settings-section">
              <h3 title={t("voiceSettingsModal.whetherRepliesAreReadBack")}>{t("voiceSettingsModal.replyReadback")}</h3>
              <div className="voice-settings-field">
                <span>{t("voiceSettingsModal.readRepliesAloud")}</span>
                <OptionList
                  compact
                  label={t("voiceSettingsModal.readRepliesAloud")}
                  value={draft.ttsEnabled ? "on" : "off"}
                  options={[
                    { id: "on", label: t("voiceSettingsModal.on"), title: t("voiceSettingsModal.speakEachReplyUsingAnInstalled") },
                    { id: "off", label: t("voiceSettingsModal.off"), title: t("voiceSettingsModal.showRepliesOnScreenOnly") },
                  ]}
                  onChange={(id) => patch({ ttsEnabled: id === "on" })}
                />
              </div>
              {draft.ttsEnabled ? (
                <>
                  <label className="voice-settings-field">
                    <span>{t("voiceSettingsModal.voice")}</span>
                    <select
                      className="input"
                      value={draft.ttsVoice ?? ""}
                      title={t("voiceSettingsModal.systemVoiceUsedToRead")}
                      onChange={(event) => patch({ ttsVoice: event.target.value || null })}
                    >
                      <option value="">{t("voiceSettingsModal.systemDefault")}</option>
                      {voices.map((voice) => (
                        <option key={voice.name} value={voice.name}>
                          {voice.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="voice-settings-field">
                    <span>{t("voiceSettingsModal.rate")}</span>
                    <input
                      className="input"
                      type="range"
                      min={0.6}
                      max={2}
                      step={0.1}
                      value={draft.ttsRate}
                      title={t("voiceSettingsModal.speechRateX", { value: draft.ttsRate.toFixed(1) })}
                      onChange={(event) => patch({ ttsRate: Number(event.target.value) })}
                    />
                  </label>
                </>
              ) : null}
            </section>

            <section className="voice-settings-section">
              <h3 title={t("voiceSettingsModal.howTheCallDecidesYou")}>{t("voiceSettingsModal.callBehaviour")}</h3>
              <div className="voice-settings-field">
                <span>{t("voiceSettingsModal.defaultMode")}</span>
                <OptionList
                  compact
                  label={t("voiceSettingsModal.defaultVoiceMode")}
                  value={draft.mode}
                  options={MODE_OPTIONS()}
                  onChange={(id) => patch({ mode: id })}
                />
              </div>
              <label className="voice-settings-field">
                <span>{t("voiceSettingsModal.endOfSpeechSilence")}</span>
                <input
                  className="input"
                  type="number"
                  min={300}
                  max={4000}
                  step={100}
                  value={draft.vadSilenceMs}
                  title={t("voiceSettingsModal.howLongYouMustPause")}
                  onChange={(event) => patch({ vadSilenceMs: Number(event.target.value) })}
                />
              </label>
              <div className="voice-settings-field">
                <span>{t("voiceSettingsModal.interruptBySpeaking")}</span>
                <OptionList
                  compact
                  label={t("voiceSettingsModal.interruptBySpeaking")}
                  value={draft.bargeIn ? "on" : "off"}
                  options={[
                    { id: "on", label: t("voiceSettingsModal.on"), title: t("voiceSettingsModal.talkingOverAReplyStopsIt") },
                    { id: "off", label: t("voiceSettingsModal.off"), title: t("voiceSettingsModal.letEachReplyFinishBeforeListening") },
                  ]}
                  onChange={(id) => patch({ bargeIn: id === "on" })}
                />
              </div>
            </section>
          </div>

          <footer className="modal-footer">
            <button className="btn" type="button" title={t("voiceSettingsModal.discardChangesAndClose")} onClick={onClose}>
              {t("voiceSettingsModal.cancel")}
            </button>
            <button
              className="btn btn-primary"
              type="button"
              title={t("voiceSettingsModal.saveTheseVoicePreferences")}
              onClick={() => onSave(draft)}
            >
              {t("voiceSettingsModal.save")}
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  );
}
