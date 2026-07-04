# Proposal: Startup Update Splash

## Why

Basebuild already has in-app update controls, but users can launch an unsupported build before seeing update status or knowing whether an update is required. Portable Windows users also need a fast update path that does not send them through the setup `.exe` wizard.

## What Changes

- Add a startup splash/update gate that shows the current build version, update-check progress, release information, and update progress before the main app becomes interactive.
- Support optional and mandatory update policies so releases can hide the skip action and auto-start updates when the running version is below the supported minimum.
- Add portable Windows release/update support with a no-wizard update flow that downloads, verifies, applies, restarts, and cleans up without requiring the NSIS setup UI.
- Keep the existing in-app update UI for manual checks, diagnostics, and update actions after startup.
- Preserve local-first behavior: update checks/downloads contact only the configured release endpoint and do not upload local project, prompt, or telemetry data.

## Capabilities

### New Capabilities
- `startup-update-gate` - launch-time update splash, optional/mandatory update UX, and skip policy handling
- `portable-instant-updates` - portable release artifacts and fast self-update handoff without installer wizard UI

### Modified Capabilities

## Impact

- `src-tauri/tauri.conf.json` release bundle targets, updater settings, and update artifact assumptions.
- `.github/workflows/windows.yml` release artifacts for installer, portable executable/package, signatures, and update manifest policy fields.
- `src-tauri/src/commands/updater.rs` update metadata model, mandatory update policy evaluation, progress events, and update launch/apply commands.
- New or existing `src-tauri/src/services/*` update service/helper-process code for download, verification, portable replacement, relaunch, rollback, and cleanup.
- `src/lib/updater.ts`, `src/state/updater.ts`, `src/components/layout/UpdateButton.tsx`, and `src/components/layout/SettingsModal.tsx` for shared update state and continued in-app controls.
- New startup splash UI component(s) plus `src/styles/globals.css` and `DESIGN.md` if new visual classes/tokens are required.
- `docs/agents/agent-runtime.md`, `docs/agents/desktop-shell.md`, `docs/DEVELOPMENT.md`, and release documentation for startup update behavior and portable release rules.
