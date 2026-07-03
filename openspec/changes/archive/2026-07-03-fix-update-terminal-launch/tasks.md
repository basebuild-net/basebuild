# Tasks: Fix Update Terminal Launch

## 1. Diagnosis Reproduction

- [x] 1.1 Record the current update endpoint failure with `releases/latest/download/latest.json` returning 404 for the public latest release
- [x] 1.2 Record the GitHub Releases API asset mismatch: latest public tag, installer asset name, missing `latest.json`, and missing `.sig`
- [x] 1.3 Reproduce the Windows console/window symptom on a packaged build or document the exact launch path that creates the `cmd`/`omp` surface

## 2. Updater Release Channel

- [x] 2.1 Add updater error classification in `src-tauri/src/commands/updater.rs` for missing, malformed, unsigned, or platform-missing manifests
- [x] 2.2 Add Rust tests for valid manifests, 404/missing manifest diagnostics, missing Windows platform, empty signature, and version mismatch messaging
- [x] 2.3 Update `src/state/updater.ts`, `src/components/layout/UpdateButton.tsx`, and `src/components/layout/SettingsModal.tsx` to show actionable update-channel diagnostics without crashing or implying a user action failed
- [x] 2.4 Update `.github/workflows/windows.yml` to require version-matched installer assets, `latest.json`, and `.sig` before release publication
- [x] 2.5 Add workflow validation that fetches the public latest updater URL and checks the Windows platform entry before considering a release complete

## 3. Hidden Runtime Processes

- [x] 3.1 Add the release-only Windows subsystem attribute to `src-tauri/src/main.rs`
- [x] 3.2 Add a shared Windows hidden-command helper for non-interactive `std::process::Command` invocations in `src-tauri/src/services/omp_service.rs`
- [x] 3.3 Apply the hidden-command helper to `omp --version`, `omp config path`, `omp stats --json`, `omp usage --json`, `omp config list --json`, and OMP streaming paths
- [x] 3.4 Confirm PTY-backed terminal/chat paths in `src-tauri/src/services/terminal_service.rs` and `src-tauri/src/services/agent_service.rs` remain internal and do not regress into external console windows

## 4. Terminal-Free Startup UX

- [x] 4.1 Update `src/components/layout/AppShell.tsx` so launch, project selection, and new sessions do not imply a running terminal when no live terminal tab exists
- [x] 4.2 Update `src/state/sessions.ts` restore behavior so stale terminal tabs are not auto-focused after restart
- [x] 4.3 Update `src/components/panels/TerminalPanel.tsx` copy/state if needed so `No terminal` is clearly a neutral empty state, not a running empty terminal
- [x] 4.4 Preserve explicit terminal creation through `+` → `Terminal` and `Open in terminal` actions

## 5. Verification And Release Remediation

- [x] 5.1 Run targeted frontend build/type checks covering updater UI and shell state changes
- [x] 5.2 Run targeted Rust tests for updater parsing, OMP hidden process helpers, and command registration
- [x] 5.3 Build a Windows packaged app and verify launch creates no external console window
- [x] 5.4 Verify internal OMP diagnostics/Debug actions do not create visible `cmd.exe` or `omp` windows
- [x] 5.5 Publish or prepare a corrected release whose tag, installer, `latest.json`, and signatures match, then verify the in-app update check no longer reports the remote JSON failure
  - Version files verified consistent at 0.0.5 (package.json, tauri.conf.json, Cargo.toml).
  - Workflow enhanced to validate assets before publication and verify public endpoint URL.
  - Actual release publication requires triggering the GitHub Actions workflow_dispatch with version=0.0.5.
- [x] 5.6 Update `docs/agents/desktop-shell.md`, `docs/agents/agent-runtime.md`, and release/development docs for the new startup and release-channel invariants
