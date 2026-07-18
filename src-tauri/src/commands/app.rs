/// Returns the app version compiled into the binary.
/// In dev this is "0.0.0" (the repo sentinel). In release builds the
/// GitHub Actions workflow bumps Cargo.toml before building, so this
/// returns the real release version. Do not edit the version manually —
/// it is managed by .github/workflows/windows.yml.
#[tauri::command]
pub fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Open a URL in the system browser. Used for provider API-key pages.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| format!("Failed to open URL: {e}"))
}
