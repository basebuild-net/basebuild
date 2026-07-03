# Design: Fix Update Terminal Launch

## Context

Diagnosis found two independent regressions.

1. **Updater channel is broken for the current public latest release.** `src-tauri/tauri.conf.json` points the Tauri updater at `https://github.com/basebuild-net/basebuild/releases/latest/download/latest.json`. Fetching that URL redirects to `v0.0.4` and returns HTTP 404. The GitHub releases API currently lists `v0.0.4` as latest, with only one asset named `Basebuild_0.0.2_x64-setup.exe`; there is no `latest.json` and no `.sig` asset. The repo working tree versions are `0.0.5` in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`, but no public `v0.0.5` release is available through the API. This explains the user-facing `Could not fetch a valid release JSON from the remote` failure.
2. **Windows process visibility is not consistently internal.** `src-tauri/src/main.rs` lacks the standard release-only `windows_subsystem = "windows"` attribute, so packaged Windows builds can allocate a console window. PTY-backed terminal and agent spawns use `portable-pty`; the vendored Windows ConPTY code already passes `CREATE_NO_WINDOW`. Non-interactive OMP helpers in `src-tauri/src/services/omp_service.rs` use `std::process::Command` directly, which can create visible console windows for console-subsystem child processes when the parent has no console. The app also defaults the workspace tool to Terminal and can show an empty terminal-oriented state even when no terminal process exists.

## Goals / Non-Goals

**Goals**:
- Make the next published release produce valid signed updater metadata and installer assets before it becomes public.
- Make update-check failures actionable for maintainers and non-fatal for users.
- Remove all unintended external Windows console windows from packaged launch and internal OMP helpers.
- Keep user-created terminal tabs visible inside Basebuild only.
- Make startup and project selection feel terminal-free until the user explicitly opens a terminal or chat.

**Non-Goals**:
- Changing the update host away from GitHub Releases.
- Disabling automatic update checks entirely.
- Replacing Tauri's signed updater plugin.
- Removing explicit Terminal tabs or the Debug panel.
- Changing OMP installation, configuration, or authentication behavior beyond hidden process spawning.

## Decisions

### Decision: Fix release assets at the pipeline, not by weakening updater validation
**Rationale**: Tauri signed updates require a valid manifest and signatures. Treating a missing `latest.json` as success would hide a broken release channel and could leave users stranded. The release workflow should fail before publication if the public endpoint would 404 or serve invalid metadata.  
**Alternatives**: Suppress update errors in the UI. Rejected because it masks the release pipeline failure and does not restore one-click updates.

### Decision: Keep GitHub Releases as the canonical update endpoint
**Rationale**: The app is already configured for `releases/latest/download/latest.json`, the release workflow uses `tauri-apps/tauri-action`, and no new infrastructure is required.  
**Alternatives**: Host `latest.json` on a custom endpoint. Rejected for this fix because it adds infrastructure and does not address missing release assets.

### Decision: Add Windows subsystem metadata in `main.rs`
**Rationale**: A packaged desktop app should not be a console-subsystem executable. The standard Tauri pattern hides the parent console in release builds while preserving debug console behavior during development.
**Alternatives**: Hide the console at runtime after launch. Rejected because the window can flash before code runs and is less reliable than the subsystem flag.

### Decision: Centralize hidden Windows command spawning for OMP helpers
**Rationale**: Every non-interactive `std::process::Command` path should share the same Windows `CREATE_NO_WINDOW` behavior and stdout/stderr capture. This avoids fixing `run_omp` while leaving `stream_command` or future helpers visible.
**Alternatives**: Convert OMP helpers to PTY spawns. Rejected because diagnostics and JSON commands are not interactive terminals and should not allocate PTY resources.

### Decision: Separate terminal UI state from terminal process state
**Rationale**: The user should not see an empty Terminal area and infer a running terminal when no PTY exists. Terminal processes should be created only by explicit terminal/chat actions; restored terminal tabs must be treated as stale unless backed by a live in-memory PTY.
**Alternatives**: Auto-create a terminal for every session. Rejected because it is the observed unwanted behavior and creates silent side effects.

## Risks / Trade-offs

- **Existing published releases cannot be repaired by code alone** → Mitigation: publish a corrected release with matching version, `latest.json`, and signatures; optionally delete or supersede broken assets according to release policy.
- **Release workflow checks may need authenticated GitHub API access** → Mitigation: use existing `GITHUB_TOKEN` and verify both draft assets and public latest URL before final publication.
- **Windows hidden-process behavior is platform-specific** → Mitigation: gate `CREATE_NO_WINDOW` behind `#[cfg(windows)]` and keep Unix behavior unchanged.
- **Debugging OMP helpers becomes less visible** → Mitigation: keep stdout/stderr captured in app diagnostics and Debug panel instead of external consoles.
- **Startup UI change may affect users who expect Terminal first** → Mitigation: explicit `+` → `Terminal` remains one click; no terminal process is created until that click.

## Migration Plan

1. Add tests for updater manifest parsing/error classification and release asset version expectations.
2. Update `.github/workflows/windows.yml` to validate version-matched installer, `latest.json`, and signature assets, then verify the public updater URL before publication or immediately after publication with fail-fast rollback guidance.
3. Add the Windows subsystem attribute to `src-tauri/src/main.rs` for release builds.
4. Add a Windows hidden-command helper for `std::process::Command` use in `src-tauri/src/services/omp_service.rs`; apply it to status/config/stats/usage/stream paths.
5. Adjust startup/session restore UI so no Terminal panel is focused or shown as running unless a live terminal tab exists or the user explicitly creates one.
6. Publish a corrected release where the tag, package/Tauri/Cargo versions, installer asset, `latest.json`, and signature assets all match.

## Open Questions

- Should the broken `v0.0.4` release remain public with a warning, or should it be marked superseded after a corrected release is published?
- Should the app show a quieter taskbar update state for known release-channel outages while keeping full diagnostics in Settings?
