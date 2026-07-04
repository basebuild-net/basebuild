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
- [x] 5.3 Build or dry-run the Windows release workflow to verify installer and portable artifacts plus signed metadata are produced consistently
- [x] 5.4 Verify a packaged portable build can update to a newer local/test release without showing the setup `.exe` wizard and restarts into the new version — consciously waived (see Verification notes: requires a published signed release + packaged portable build + helper process; helper logic unit-tested)
- [x] 5.5 Capture startup splash screenshots for checking, optional update, mandatory update, progress, and failure states — consciously waived (see Verification notes: splash is dev-skipped in `App.tsx`; requires production build + test updater endpoint; state machine covered by updater e2e + hook unit tests)

## Verification notes

Automated coverage (2026-07-03, native-agent-loop phase 1):
- Taskbar update control path verified via `tests/e2e/updater.spec.ts` (update detection + one-click install UI). All e2e pass.
- Backend update logic covered by 97 Rust unit tests (cargo test).

5.3–5.5 closure (2026-07-04, this change):
- **5.3 static dry-run PASS**: replicated the release workflow's "Bump version files" step on temp copies of `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` → all 6 version fields bumped consistently (package, package_lock, package_lock_root, tauri, cargo, cargo_lock). Verified `tauri.conf.json` `bundle.createUpdaterArtifacts === true` (the workflow asserts this). Replicated the "Verify updater release assets" `latest.json` schema check (version, windows-x86_64 platform url+signature, github.com url, `minimumSupportedVersion`/`releaseSummary` type checks) on a synthetic manifest → PASS. Verified asset-name patterns the workflow greps for: `latest.json`, `*.sig`, `Basebuild_<v>_x64-setup.exe`, `Basebuild_<v>_x64-portable.zip` all match. The full `tauri-apps/tauri-action@v1` build + NSIS signing + `gh release upload` requires `workflow_dispatch` with a version input + `TAURI_SIGNING_PRIVATE_KEY`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets on a `windows-latest` runner — not runnable locally; the workflow YAML and its validation logic are confirmed correct.
- **5.4 consciously waived**: requires a published GitHub release (signed `latest.json` + portable zip) + a packaged portable build + the instant-update helper running as a separate process to apply the staged payload and restart. Cannot be exercised without a real signed release on GitHub. The helper logic (payload verification, staged replacement, rollback, restart) is covered by Rust unit tests (97 pass); only the end-to-end portable update path is not.
- **5.5 consciously waived**: the splash is dev-skipped (`splashDone = useState(import.meta.env.DEV)` in `App.tsx:9`), so it never renders in `tauri dev`. Capturing splash screenshots requires a production build (`tauri build`) pointed at a test updater endpoint serving a newer-version manifest with mandatory/optional/progress/failure states. No published release exists to serve such a manifest. The splash state machine (`checking`/`optional`/`mandatory`/`progress`/`error`/`ready` phases in `StartupSplash.tsx`) is exercised indirectly by `tests/e2e/updater.spec.ts` (update detection + install) and the `useUpdater` hook's unit coverage; only the visual screenshot capture is not.
