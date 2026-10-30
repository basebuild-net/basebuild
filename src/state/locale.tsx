import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  parseLocalePreference,
  resolveLocale,
  setActiveLocale,
  type LocalePreference,
  type ResolvedLocale,
} from "../i18n";
import { setUiLocale } from "../lib/locale";

const STORAGE_KEY = "basebuild.locale";

type LocaleContextValue = {
  preference: LocalePreference;
  locale: ResolvedLocale;
  setPreference: (next: LocalePreference) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Read the stored preference from localStorage. Mirrors the theme store:
 * the value is applied synchronously so the first paint is already localized.
 * Missing, malformed, or unavailable storage yields `system`.
 */
function loadPreference(): LocalePreference {
  try {
    return parseLocalePreference(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "system";
  }
}

function savePreference(preference: LocalePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage write failed (private mode, quota). The in-memory choice still
    // applies for this session.
  }
}

/**
 * Owns the UI language. Sets the module-level catalog during render so `t()`
 * is correct for every child, and mirrors the resolved locale to the backend
 * so Rust-side copy (tray labels, model language directive) matches.
 *
 * Components do not subscribe individually: `App` calls `useLocale()`, so a
 * language change re-renders the whole tree from the root.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LocalePreference>(loadPreference);
  const locale = resolveLocale(preference, typeof navigator === "undefined" ? "en" : navigator.language);
  setActiveLocale(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    setUiLocale(preference, locale).catch((error: unknown) => {
      console.warn("[locale] failed to mirror UI locale to the backend", error);
    });
  }, [preference, locale]);

  const setPreference = useCallback((next: LocalePreference) => {
    savePreference(next);
    setPreferenceState(next);
  }, []);

  const value = useMemo(
    () => ({ preference, locale, setPreference }),
    [preference, locale, setPreference],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Current preference and resolved locale. Call from the root to subscribe. */
export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside LocaleProvider");
  return value;
}
