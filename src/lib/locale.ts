import { invoke } from "@tauri-apps/api/core";
import type { LocalePreference, ResolvedLocale } from "../i18n";

/** Mirror the UI language to the backend (tray labels, model directive). */
export async function setUiLocale(preference: LocalePreference, effective: ResolvedLocale): Promise<void> {
  return invoke<void>("set_ui_locale", { preference, effective });
}
