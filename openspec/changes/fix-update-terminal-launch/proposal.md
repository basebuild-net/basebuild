# Proposal: Fix Update Terminal Launch

## Why

The 0.0.5 desktop build reports `Failed to check for updates: Could not fetch a valid release JSON from the remote` on startup, and Windows users can see an empty external `cmd`/`omp` console surface when Basebuild launches or probes OMP. These regressions make the app look broken before the user has taken any action.

## What Changes

- Fix release/update delivery so every published Windows release has signed Tauri updater metadata (`latest.json` plus signature assets) whose version and installer name match the release version.
- Add release validation that fails before publishing when the updater endpoint would return 404, invalid JSON, a missing Windows platform, or missing signatures.
- Improve updater diagnostics so the app surfaces an actionable update-channel problem instead of a generic remote JSON failure.
- Keep packaged Windows launches console-free by building the Tauri binary as a Windows subsystem application.
- Ensure internal OMP probes and helper commands do not create visible `cmd.exe`/`omp` windows.
- Ensure Basebuild does not spawn or focus a terminal process on launch, project selection, or session restore unless the user explicitly opens a terminal/chat/debug action that requires one.

## Capabilities

### New Capabilities
- `desktop-update-delivery` - reliable signed release metadata, updater checks, and update-channel diagnostics
- `desktop-runtime-processes` - hidden/internal runtime process handling and terminal-free startup behavior

### Modified Capabilities

## Impact

- `.github/workflows/windows.yml` release workflow and release asset validation.
- `src-tauri/tauri.conf.json` updater endpoint assumptions and signed metadata compatibility.
- `src-tauri/src/commands/updater.rs` updater error mapping and manifest validation tests.
- `src-tauri/src/main.rs` Windows subsystem setting for packaged builds.
- `src-tauri/src/services/omp_service.rs` non-interactive OMP process spawning.
- `src-tauri/src/services/agent_service.rs` and `src-tauri/src/services/terminal_service.rs` process visibility regression tests or code review checks.
- `src/components/layout/AppShell.tsx`, `src/state/sessions.ts`, and `src/components/panels/TerminalPanel.tsx` startup/session restore behavior.
- `docs/agents/desktop-shell.md`, `docs/agents/agent-runtime.md`, and release/development docs if behavior or release rules change.
