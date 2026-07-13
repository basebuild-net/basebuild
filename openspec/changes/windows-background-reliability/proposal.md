# Proposal: Windows Background Reliability

## Why

Basebuild already supports close-to-tray, startup update checks, OMP telemetry, and gated hourly account sync, but it cannot register itself to start with Windows and its account sync payload is still OMP-specific. Users who rely on Basebuild as a background control plane need a predictable minimized startup path and privacy-preserving usage synchronization that covers both externally-run OMP activity and Basebuild Native chat without requiring the main window to remain open.

## What Changes

- Add a Windows launch-at-sign-in setting backed by the operating system's autostart registration, with a default-on choice in first-run setup and the same control available later in Settings.
- Launch autostart instances hidden/minimized to the existing system tray while keeping explicit Start menu, Explorer, protocol, and second-instance launches visible and focused.
- Preserve startup update checks for both foreground and background launches; background checks stay non-blocking and expose update availability through existing tray/in-app state rather than forcing the main window open.
- Broaden account usage sync from OMP-only blobs to a normalized, usage-only envelope covering OMP ledger activity, Basebuild Native chat metrics, and future explicitly registered local usage sources.
- Keep remote sync consent-gated: sign-in, explicit auto-sync enablement, and analytics upload permission remain required. First-run may explain and offer the setting but MUST NOT silently opt a user into uploads.
- Make hourly sync independent of window visibility and renderer focus, with persisted cadence state, single-flight execution, bounded backoff, resume/reconnect catch-up, and actionable non-blocking diagnostics.
- Reconcile persisted launch preferences with Windows autostart state and recover safely from stale registrations, missing OMP, unavailable usage sources, network loss, and app upgrades.

## Capabilities

### New Capabilities

- `windows-background-startup` - Windows launch-at-sign-in registration, minimized tray startup, settings controls, and lifecycle reconciliation.

### Modified Capabilities

- `foundation-platform` - extend first-run setup and revisitable settings with the launch-at-sign-in choice while preserving conservative privacy defaults.
- `startup-update-gate` - distinguish foreground startup splash behavior from hidden background startup checks.
- `omp-account-usage-sync` - aggregate OMP and Basebuild Native usage through a resilient, consent-gated hourly background sync contract.

## Impact

- `src-tauri/Cargo.toml`, `src-tauri/capabilities/*`, and `src-tauri/src/lib.rs` for an official Tauri autostart integration and startup argument/lifecycle handling.
- New or extended Tauri models, services, and commands for startup preferences, Windows registration reconciliation, and normalized usage-source collection.
- `src/components/layout/FirstRunModal.tsx`, `src/components/layout/SettingsModal.tsx`, thin TypeScript invoke wrappers, and `src/styles/globals.css` for setup and Settings controls.
- `src-tauri/src/services/sync_service.rs` and native metrics access for multi-source, single-flight background synchronization.
- Startup/update state so minimized autostart checks do not surface or focus the main window unexpectedly.
- Rust unit/integration coverage, mocked-Tauri browser coverage, packaged Windows startup verification, and behavior/privacy documentation.
- Remote `basebuild.net` usage ingestion may need an extend-only payload/version update before native usage rows can be accepted; OMP compatibility must be preserved during rollout.
