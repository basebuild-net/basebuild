# Tasks: Startup Update Splash

## 1. Update Policy Model

- [x] 1.1 Extend backend update metadata types in `src-tauri/src/commands/updater.rs` for target version, minimum supported version, optional/mandatory status, skip eligibility, release summary, and progress state
- [x] 1.2 Add Rust tests for supported optional update, skipped target version, unsupported current version, invalid policy fields, and mandatory update failure states
- [x] 1.3 Extend `src/lib/updater.ts` and `src/state/updater.ts` with shared startup/manual update state, progress events, policy evaluation, and skip-version persistence

## 2. Startup Splash UX

- [x] 2.1 Add startup splash component(s) that show current build version, checking state, update details, optional actions, mandatory copy, progress bar, diagnostics, retry, and safe exit states
- [x] 2.2 Wire the splash into app startup before the main shell becomes interactive while preserving fast transition for no-update and skipped-optional cases
- [x] 2.3 Reuse existing design primitives and update `src/styles/globals.css` plus `DESIGN.md` only for any required new global classes
- [x] 2.4 Keep `UpdateButton` and `SettingsModal` update controls functional with the shared updater state after startup

## 3. Portable Release Delivery

- [x] 3.1 Update `.github/workflows/windows.yml` and `src-tauri/tauri.conf.json` release assumptions to publish installer and portable-compatible artifacts for the same version
- [x] 3.2 Add release validation that checks portable artifact naming, embedded version, manifest target, signature, and updater policy fields before publication
- [x] 3.3 Document the portable artifact format and release policy fields in release/development docs

## 4. Instant Update Helper

- [x] 4.1 Add a trusted Windows updater helper or equivalent handoff service that can download or receive a staged payload, show progress, wait for Basebuild exit, apply the update, and restart the new app
- [x] 4.2 Implement payload verification, staged replacement, rollback/preserve-old-build behavior, temp cleanup, and restart confirmation for portable builds
- [x] 4.3 Route portable and supported installed builds through the no-wizard update path when the release manifest provides a compatible payload
- [x] 4.4 Surface helper progress and failures back to the splash/manual update UI where possible

## 5. Verification And Docs

- [x] 5.1 Run targeted Rust tests for update metadata parsing, policy evaluation, helper handoff, verification, rollback, and command registration
- [x] 5.2 Run targeted frontend type checks/tests covering splash states, optional skip, mandatory update, progress, diagnostics, and existing Settings/taskbar update controls
- [ ] 5.3 Build or dry-run the Windows release workflow to verify installer and portable artifacts plus signed metadata are produced consistently
- [ ] 5.4 Verify a packaged portable build can update to a newer local/test release without showing the setup `.exe` wizard and restarts into the new version
- [ ] 5.5 Capture startup splash screenshots for checking, optional update, mandatory update, progress, and failure states
- [x] 5.6 Update `docs/agents/agent-runtime.md`, `docs/agents/desktop-shell.md`, `docs/DEVELOPMENT.md`, and any release docs affected by startup update and portable-release behavior
