import { useCallback, useEffect, useState } from "react";

export type AppTheme = "dark" | "light";

export const THEME_IDS = ["dark", "light"] as const;
const STORAGE_KEY = "basebuild.theme";
const DEFAULT_THEME: AppTheme = "dark";

/**
 * Parse an untrusted stored value into a valid AppTheme.
 * Only exact "dark" or "light" strings are accepted; everything
 * else (missing, malformed, unsupported) falls back to dark.
 * The value is never interpolated into HTML, selectors, URLs, or commands.
 */
export function parseTheme(value: string | null): AppTheme {
  if (value === "dark" || value === "light") return value;
  return DEFAULT_THEME;
}

/**
 * Read the stored theme from localStorage.
 * Returns dark if storage is unavailable, empty, or contains an
 * unsupported value. Never throws.
 */
function loadTheme(): AppTheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return parseTheme(stored);
  } catch {
    // Storage access may throw (private mode, quota, security policy).
    // Fall back to dark without crashing startup.
    return DEFAULT_THEME;
  }
}

/**
 * Persist a theme to localStorage.
 * Silently ignores storage failures — the in-memory state remains
 * authoritative for the current session.
 */
function saveTheme(theme: AppTheme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage write failed (private mode, quota). Non-fatal: the
    // theme still applies for this session via the root attribute.
  }
}

/**
 * Apply a theme to the document root.
 * Sets both the data attribute (consumed by CSS theme blocks) and
 * the native color-scheme property (controls form controls/scrollbars).
 */
export function applyTheme(theme: AppTheme): void {
  const root = document.documentElement;
  root.dataset.bbTheme = theme;
  root.style.colorScheme = theme;
}

/**
 * React hook for theme state.
 *
 * On mount, synchronizes React state with the pre-React bootstrap value
 * already applied to the document root. Exposes `setTheme` for user-triggered
 * changes: validates, persists, applies, and debug-logs the change.
 *
 * The hook is intentionally simple — no context provider — because theme
 * state has a single consumer (Settings → Themes) and the root attribute
 * is the source of truth for CSS. A future `system` mode or third theme
 * extends the registry here without touching component code.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<AppTheme>(DEFAULT_THEME);

  // Sync React state with the bootstrap value on mount.
  useEffect(() => {
    const current = loadTheme();
    setThemeState(current);
    // Ensure the root attribute matches (in case bootstrap was bypassed).
    applyTheme(current);
  }, []);

  const setTheme = useCallback(
    (next: AppTheme) => {
      setThemeState((prev) => {
        if (prev === next) return prev;
        applyTheme(next);
        saveTheme(next);
        // Debug log for user-triggered theme changes (Invariant 14).
        // eslint-disable-next-line no-console
        console.debug(`[theme] user changed theme: ${prev} → ${next}`);
        return next;
      });
    },
    [],
  );

  return { theme, setTheme };
}
