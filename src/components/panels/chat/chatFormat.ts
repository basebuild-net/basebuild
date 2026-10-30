import type { NativeModel, NativeProvider, NativeProviderCatalog, VoiceBilling, VoiceLevel } from "../../../lib/native-chat";
import { t } from "../../../i18n";
import { formatRelativeTime, formatDateTime } from "../../../i18n/format";

export const SEND_TIMEOUT_MS = 45_000;
export const NATIVE_PROFILE_ID = "basebuild-native";
export const LOCAL_PROVIDER_ID = "basebuild-local";

/** Localized effort name for the composer chip. Unknown ids keep the catalog label. */
export function effortDisplayLabel(id: string, fallback: string): string {
  switch (id) {
    case "low": return t("chatComposerControls.effortLow");
    case "medium": return t("chatComposerControls.effortMedium");
    case "high": return t("chatComposerControls.effortHigh");
    case "xhigh": return t("chatComposerControls.effortXhigh");
    default: return fallback;
  }
}

export function waitForProviderLoginPoll(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  window.setTimeout(resolve, 750);
  return promise;
}

export function CONNECTED_VIA_LABELS(): Record<string, string> {
  return {
    oauth: "OAuth",
    omp: "Oh My Pi",
    api: t("chatFormat.connectedViaLabelsApi"),
  };
}

/** Friendly names for the catalog sources cross-referenced during refresh. */
function MODEL_SOURCE_LABELS(): Record<string, string> {
  return {
    catalog_sync: t("chatFormat.modelSourceLabelsCatalogSync"),
    bundled: t("chatFormat.modelSourceLabelsBundled"),
    provider_discovered: t("chatFormat.modelSourceLabelsProviderDiscovered"),
    omp_cli: "Oh My Pi",
    hosted_fallback: t("chatFormat.modelSourceLabelsHostedFallback"),
  };
}

/** Describe which sources confirmed a model. A live source (the provider's own
 *  /v1/models or `omp models`) means the model was actually detected as
 *  available, not merely listed in a static catalog — that earns the check. */
export function modelDetection(model: NativeModel): { live: boolean; tooltip: string } {
  const sources = model.detectedBy ?? [];
  const live = sources.some((s) => s === "provider_discovered" || s === "omp_cli");
  const names = sources.map((s) => MODEL_SOURCE_LABELS()[s] ?? s);
  if (names.length === 0) return { live: false, tooltip: t("chatFormat.source", { source: model.source }) };
  return {
    live,
    tooltip: `${live ? t("chatFormat.detectedAvailableBy") : t("chatFormat.listedIn")}: ${names.join(", ")}`,
  };
}

export function ACCOUNT_AUTH_LABELS(): Record<string, string> {
  return {
    oauth: "OAuth",
    omp: "Oh My Pi",
    api: t("chatFormat.accountAuthLabelsApi"),
  };
}

export function ACCOUNT_HEALTH_LABELS(): Record<string, string> {
  return {
    healthy: t("chatFormat.accountHealthLabelsHealthy"),
    rate_limited: t("chatFormat.accountHealthLabelsRateLimited"),
    auth_expired: t("chatFormat.accountHealthLabelsAuthExpired"),
    error: t("chatFormat.accountHealthLabelsError"),
  };
}

/** Compact k/M formatting for token counts. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Manage-modal section tabs. */
export type ManageTab = "accounts" | "connect" | "usage";

/** Human request rate over a window: "≈3.2 reqs/h" when dense,
 * "≈1 req every 6h" / "≈1 req every 1.5d" when sparse. */
export function formatRequestRate(requests: number, windowSecs: number): string | null {
  if (requests <= 0 || windowSecs <= 0) return null;
  const hours = windowSecs / 3600;
  const perHour = requests / hours;
  if (perHour >= 1) return `≈${perHour >= 10 ? perHour.toFixed(0) : perHour.toFixed(1)} reqs/h`;
  const hoursPerReq = hours / requests;
  if (hoursPerReq < 48) return t("chatFormat.reqEveryH", { value1: hoursPerReq >= 10 ? hoursPerReq.toFixed(0) : hoursPerReq.toFixed(1) });
  return t("chatFormat.reqEveryDay", { v1: (hoursPerReq / 24).toFixed(1) });
}

/** Token throughput over a window: "≈12.4k tok/h". */
export function formatTokenRate(tokens: number, windowSecs: number): string | null {
  if (tokens <= 0 || windowSecs <= 0) return null;
  return `≈${formatTokens(Math.round(tokens / (windowSecs / 3600)))} tok/h`;
}

/** Normalize a timestamp to milliseconds. The Rust backend stores Unix
 * seconds; the e2e mock stores ms. Values < 10^12 are treated as seconds. */
function toMs(ts: number | null | undefined): number | null {
  if (ts == null) return null;
  return ts < 1e12 ? ts * 1000 : ts;
}

/** Relative time "2h ago" / "just now" from a timestamp (seconds or ms). */
export function accountRelativeTime(ts: number | null | undefined): string | null {
  if (ts == null) return null;
  return formatRelativeTime(ts);
}

/** "Connected Jul 5, 2026 · 2d ago" from a timestamp (seconds or ms). */
export function accountConnectedLabel(ts: number | null | undefined): string | null {
  const ms = toMs(ts);
  if (ms == null) return null;
  const date = formatDateTime(new Date(ms), { year: "numeric", month: "short", day: "numeric" });
  const rel = accountRelativeTime(ts);
  return rel ? `${date} · ${rel}` : date;
}

/** Seconds until a cooldown timestamp (ms), or null if not cooling down. */
export function cooldownSecondsLeft(cooldownUntil: number | null | undefined): number | null {
  if (cooldownUntil == null) return null;
  const ms = cooldownUntil - Date.now();
  if (ms <= 0) return null;
  return Math.ceil(ms / 1000);
}

/** "2 accounts · 1 OAuth · 1 API key" for provider cards (omits zero parts). */
export function accountSummaryLabel(provider: NativeProvider): string {
  const parts: string[] = [];
  parts.push(provider.accountCount === 1 ? t("chatFormat.accountCountOne", { count: provider.accountCount }) : t("chatFormat.accountCountOther", { count: provider.accountCount }));
  if (provider.oauthCount > 0) parts.push(t("chatFormat.oauthCount", { count: provider.oauthCount }));
  if (provider.apiKeyCount > 0) parts.push(provider.apiKeyCount === 1 ? t("chatFormat.apiKeyCountOne", { count: provider.apiKeyCount }) : t("chatFormat.apiKeyCountOther", { count: provider.apiKeyCount }));
  return parts.join(" · ");
}

/** Auth paths a provider supports, for the catalog card meta line. */
export function providerAuthOptionsLabel(provider: NativeProvider): string {
  if (provider.authMethod === "local") return "";
  if (provider.authMethod === "oauth") {
    return provider.apiKeyUrl ? t("chatFormat.oauthOrApiKey") : "OAuth";
  }
  return t("chatFormat.apiKey");
}

// ─── Voice capability ───

/** Voice levels the picker renders a badge for. `none` is excluded: a model
 *  without a voice route gets no badge at all. */
export type VoiceBadgeLevel = Exclude<VoiceLevel, "none">;

/** Short badge text per voice level. */
export function VOICE_LEVEL_LABELS(): Record<VoiceBadgeLevel, string> {
  return {
    stt: t("chatFormat.voiceLevelLabelsStt"),
    tts: t("chatFormat.voiceLevelLabelsTts"),
    audio_turn: t("chatFormat.voiceLevelLabelsAudioTurn"),
    realtime: t("chatFormat.voiceLevelLabelsRealtime"),
  };
}

/** What each level actually buys you, for the badge tooltip. */
export function VOICE_LEVEL_TITLES(): Record<VoiceBadgeLevel, string> {
  return {
    stt: t("chatFormat.voiceLevelTitlesStt"),
    tts: t("chatFormat.voiceLevelTitlesTts"),
    audio_turn: t("chatFormat.voiceLevelTitlesAudioTurn"),
    realtime: t("chatFormat.voiceLevelTitlesRealtime"),
  };
}

/** Short badge text per billing route. */
export function VOICE_BILLING_LABELS(): Record<VoiceBilling, string> {
  return {
    api_key: t("chatFormat.voiceBillingLabelsApiKey"),
    subscription: t("chatFormat.voiceBillingLabelsSubscription"),
    local: t("chatFormat.voiceBillingLabelsLocal"),
  };
}

/** How the route is paid for, for the badge tooltip. */
export function VOICE_BILLING_TITLES(): Record<VoiceBilling, string> {
  return {
    api_key: t("chatFormat.voiceBillingTitlesApiKey"),
    subscription: t("chatFormat.voiceBillingTitlesSubscription"),
    local: t("chatFormat.voiceBillingTitlesLocal"),
  };
}

/** True when the provider's only sign-in path is a consumer subscription
 *  OAuth flow (ChatGPT, Claude, Grok). Such a session carries no audio or
 *  realtime scope, so an API-billed voice route is not covered by it. */
export function isSubscriptionOAuthRoute(provider: NativeProvider | null | undefined): boolean {
  if (!provider) return false;
  if (provider.connectedVia === "oauth" || provider.connectedVia === "omp") return true;
  return provider.authMethod === "oauth" && !provider.apiKeyUrl;
}

/** The one sentence worth saying when an API-billed realtime model sits under
 *  a provider the user signed into with a subscription. Null when there is no
 *  mismatch to report. */
export function voiceBillingMismatch(
  model: NativeModel,
  provider: NativeProvider | null | undefined,
): string | null {
  if (!provider) return null;
  if (model.voice?.level !== "realtime" || model.voice.billing !== "api_key") return null;
  if (!isSubscriptionOAuthRoute(provider)) return null;
  return t("chatFormat.realtimeVoiceOnRequiresApiBilling", { id: model.id, label: provider.label });
}

export type LegacyChatMessage = { role: "user" | "assistant" | "system"; content: string };

/**
 * Detect enumerated quick-reply options in a completed assistant message.
 * Conservative: only matches `^[A-H][).:\s]\s` patterns or explicit
 * "reply with X/Y" phrasing. Skips content inside code fences. Returns
 * at most 8 option labels.
 */
export function detectProseQuickReplies(content: string): string[] {
  // Strip code fences so we don't match code blocks.
  const stripped = content.replace(/```[\s\S]*?```/g, "");
  const lines = stripped.split("\n");
  const options: string[] = [];
  const optionPattern = /^([A-H])[)\.:]\s+(.+)/;
  for (const line of lines) {
    const m = line.match(optionPattern);
    if (m) {
      const label = `${m[1]}. ${m[2].trim()}`;
      if (label.length <= 80 && !options.includes(label)) {
        options.push(label);
      }
    }
    if (options.length >= 8) break;
  }
  // Also check for "reply with X/Y/Z" phrasing.
  if (options.length === 0) {
    const replyMatch = stripped.match(/reply with\s+([A-Za-z0-9 ]+(?:\/[A-Za-z0-9 ]+)+)/i);
    if (replyMatch) {
      const parts = replyMatch[1].split("/").map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        if (part.length <= 40 && !options.includes(part)) options.push(part);
      }
    }
  }
  return options;
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return seconds === 1 ? t("chatFormat.oneSecond") : t("chatFormat.manySeconds", { count: seconds });
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const minLabel = m === 1 ? t("chatFormat.oneMinute") : t("chatFormat.manyMinutesShort", { count: m });
  const secLabel = s === 1 ? t("chatFormat.oneSecondShort") : t("chatFormat.manySecondsShort", { count: s });
  if (m < 60) return `${minLabel} ${secLabel}`;
  const h = Math.floor(m / 60);
  const remainingMin = m % 60;
  const hourLabel = t("chatFormat.manyHoursShort", { count: h });
  const remMinLabel = remainingMin === 1 ? t("chatFormat.oneMinuteShort") : t("chatFormat.manyMinutesShort", { count: remainingMin });
  return `${hourLabel} ${remMinLabel}`;
}

export function resolveAssistantLabel(
  catalog: NativeProviderCatalog | null,
  selectedModel: NativeModel | null,
  modelId: string,
  providerId: string | null,
): string {
  if (providerId && modelId) {
    const catalogModel = catalog?.models.find((m) => m.providerId === providerId && m.id === modelId);
    if (catalogModel) return catalogModel.label;
  }
  return selectedModel?.label ?? modelId ?? t("chatFormat.assistant");
}

/**
 * Longest reply we will read aloud before cutting it off. Speech runs at
 * roughly 15 characters per second, so this is about a minute of talking:
 * past that the user wants to read, not listen.
 */
const MAX_SPEECH_CHARS = 900;

/**
 * Flatten an assistant reply into something worth hearing.
 *
 * Markdown read literally is unbearable: a speech engine will happily
 * pronounce every backtick, pipe and asterisk, and it will spell out a
 * forty-line diff one bracket at a time. Code is summarized rather than
 * spoken, because nobody has ever wanted a patch read to them.
 */
export function speechText(markdown: string): string {
  let text = markdown;
  // Fenced code: announce it, never read it.
  text = text.replace(/```[\s\S]*?```/g, " (code block) ");
  // Inline code: short spans are usually a name worth saying, long ones are
  // paths or snippets that are noise out loud.
  text = text.replace(/`([^`]+)`/g, (_match, inner: string) =>
    inner.length <= 40 ? inner : " (code) ",
  );
  // Links: keep the label, drop the target.
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Images contribute nothing audible.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  // Headings, list bullets and blockquote markers become sentence breaks.
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^\s*[-*+]\s+/gm, ". ");
  text = text.replace(/^\s*\d+\.\s+/gm, ". ");
  text = text.replace(/^\s*>\s?/gm, "");
  // Table pipes and horizontal rules are pure visual structure.
  text = text.replace(/^\s*\|.*\|\s*$/gm, " ");
  text = text.replace(/^\s*([-*_])\1{2,}\s*$/gm, " ");
  // Emphasis markers around a word, keeping the word.
  text = text.replace(/(\*\*|__|\*|_|~~)(.*?)\1/g, "$2");
  text = text.replace(/\s+/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();
  // Collapse the runs of ". . ." the list rewrites above can leave behind.
  text = text.replace(/(\.\s*){2,}/g, ". ").trim();
  if (text.length <= MAX_SPEECH_CHARS) return text;
  // Cut on a sentence boundary when one is close to the limit, so the readback
  // does not stop mid-word.
  const clipped = text.slice(0, MAX_SPEECH_CHARS);
  const lastStop = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "), clipped.lastIndexOf("? "));
  const body = lastStop > MAX_SPEECH_CHARS * 0.6 ? clipped.slice(0, lastStop + 1) : clipped;
  return t("chatFormat.thereIsMoreOnScreen", { value1: body.trim() });
}
