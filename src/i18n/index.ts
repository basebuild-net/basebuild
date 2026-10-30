import { en, type MessageKey } from "./en";
import { zhCN } from "./zh-CN";
import { zhTW } from "./zh-TW";

export type { MessageKey };

/** What the user picked in Settings. `system` follows the OS language. */
export const LOCALE_PREFERENCES = ["system", "en", "zh-CN", "zh-TW"] as const;
export type LocalePreference = (typeof LOCALE_PREFERENCES)[number];

/** A concrete catalog the UI can render. */
export type ResolvedLocale = "en" | "zh-CN" | "zh-TW";

type Catalog = Record<MessageKey, string>;

const CATALOGS: Record<ResolvedLocale, Catalog> = {
  en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
};

let activeLocale: ResolvedLocale = "en";

/** Parse an untrusted stored value. Unknown values fall back to `system`. */
export function parseLocalePreference(value: string | null | undefined): LocalePreference {
  return LOCALE_PREFERENCES.includes(value as LocalePreference) ? (value as LocalePreference) : "system";
}

/**
 * Resolve a preference to a catalog. `system` maps Traditional Chinese tags
 * (zh-TW, zh-HK, zh-MO, zh-Hant, ...) to zh-TW and every other Chinese tag to
 * zh-CN; any other language falls back to English.
 */
export function resolveLocale(preference: LocalePreference, systemLanguage: string): ResolvedLocale {
  if (preference !== "system") return preference;
  const tag = systemLanguage.toLowerCase();
  if (/^zh-(tw|hk|mo|hant)/.test(tag)) return "zh-TW";
  return tag.startsWith("zh") ? "zh-CN" : "en";
}

/** Set the catalog `t()` reads. Called by LocaleProvider before children render. */
export function setActiveLocale(locale: ResolvedLocale): void {
  activeLocale = locale;
}

export function getActiveLocale(): ResolvedLocale {
  return activeLocale;
}

/**
 * Translate a message key for the active locale. `{name}` placeholders are
 * replaced from `params`; a missing param leaves the placeholder visible so
 * the gap is obvious rather than silently empty.
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = CATALOGS[activeLocale][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}
