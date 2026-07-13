# Tasks: Windows Background Reliability

## 1. Windows Startup Domain

- [x] 1.1 Add the official Tauri v2 autostart plugin with the minimum required desktop capability permissions and verify the package name/version against the existing Tauri dependency line
- [x] 1.2 Add typed lifecycle settings and registration-status models for desired state, effective state, platform support, background launch mode, and privacy-safe reconciliation errors
- [x] 1.3 Implement `src-tauri/src/services/startup_service.rs` for `--background` parsing, enable/disable/read-back, idempotent reconciliation, and upgrade-path repair without direct registry manipulation
- [x] 1.4 Add validated Tauri startup commands that delegate to `startup_service`, register them in `src-tauri/src/lib.rs`, and emit required debug diagnostics without logging executable paths or sensitive values
- [x] 1.5 Add Rust tests for default state, enable/disable read-back, stale enabled/disabled registration reconciliation, unsupported platforms, path changes, idempotency, and registration failure mapping

## 2. Hidden Background Launch Lifecycle

- [x] 2.1 Make the packaged main window begin hidden and add a frontend-ready lifecycle handshake that reveals it only for explicit foreground startup
- [x] 2.2 Preserve tray `Show Basebuild`, explicit Start menu/Explorer/protocol launch, and single-instance activation so each restores, shows, and focuses the existing window
- [x] 2.3 Ensure a `--background` autostart invocation initializes the tray, updater, sync loop, and non-interactive services without showing, focusing, or flashing the main window or starting terminals/agents
- [x] 2.4 Preserve close-to-tray and bounded exit-sync behavior, including one debug event for each reveal, hide, registration, reconciliation, and skipped/failed lifecycle branch
- [x] 2.5 Add Rust lifecycle tests and mocked-Tauri browser tests for foreground launch, background launch, tray reveal, explicit second invocation, and no duplicate process or registration

## 3. First-Run And Settings Controls

- [x] 3.1 Add thin TypeScript invoke wrappers and typed state for reading/updating/retrying launch-at-sign-in registration status
- [x] 3.2 Add a first-run background-startup step with launch at sign-in selected by default, minimized-tray explanation, and no registration until the user completes setup
- [x] 3.3 Ensure Skip, Escape, overlay dismiss, and failed setup save do not create or falsely report an autostart registration
- [x] 3.4 Add a revisitable Settings control that displays desired and effective states, applies enable/disable with read-back, and offers an actionable retry when reconciliation fails
- [x] 3.5 Add `addLog("debug", ...)` entries to every new interactive handler and keep every interactive control titled, all styles in `src/styles/globals.css`, and every radius at `0px`
- [x] 3.6 Add mocked-Tauri browser coverage for default-on setup choice, opt-out, skip behavior, successful Settings toggle, unsupported platform, and registration failure recovery

## 4. Background Update Behavior

- [x] 4.1 Pass startup launch mode into the existing updater presentation so foreground launches retain `StartupSplash` and background launches run the same immediate signed check without revealing the window
- [x] 4.2 Keep optional background updates in the existing available state for later tray/in-app presentation without auto-installing or focus stealing
- [x] 4.3 Preserve mandatory update policy during background startup and expose progress or recoverable failure through existing tray/notification/update state without opening an unsupported interactive shell
- [x] 4.4 Preserve five-minute in-process checks and actionable release-channel diagnostics while preventing duplicate startup checks during foreground/background handshakes
- [x] 4.5 Add frontend tests for foreground no-update, background no-update, optional background update, mandatory background update, and background channel failure

## 5. Versioned Multi-Source Usage Contract

- [x] 5.1 Define an allowlisted, versioned `UsageRecord`/batch envelope with source kind, stable deduplication key, provider/model/plan metadata, counts, timings, cost, outcome, and no free-form content fields
- [x] 5.2 Confirm or add the extend-only basebuild.net MCP tool/version that acknowledges source-scoped batches and idempotency keys while preserving compatibility with existing `sync_raw_usage` OMP clients
- [x] 5.3 Add contract fixtures/tests for accepted OMP and native batches, duplicate retry idempotency, partial source acknowledgement, unsupported payload version, unauthorized response, and forbidden-field rejection
- [x] 5.4 Implement a final client-side payload allowlist validator that rejects prompt, response, reasoning, source, terminal, tool, secret, environment, credential, and raw-path fields before transport
- [x] 5.5 Preserve the existing OMP upload path when the server lacks multi-source support and keep native rows pending without falsely advancing checkpoints

## 6. Registered Usage Sources

- [x] 6.1 Introduce a typed read-only usage-source boundary in Rust that returns source-scoped batches, checkpoints, and privacy-safe diagnostics
- [x] 6.2 Adapt documented `omp stats --json` and `omp usage --json` collection so OMP activity is discovered whether OMP was launched inside or outside Basebuild and without attaching to or mutating the process
- [x] 6.3 Add a Basebuild Native source over the existing request metrics ledger without reading or serializing chat text, reasoning, tool content, credentials, or project paths
- [x] 6.4 Register OMP and Basebuild Native sources with independent availability and checkpoint state so missing OMP cannot block native usage and native failures cannot block OMP usage
- [x] 6.5 Add Rust tests for OMP-only, native-only, combined, missing OMP, unreadable source, empty batch, stable IDs, and source-isolated checkpoint advancement

## 7. Scheduler And Reliability Hardening

- [x] 7.1 Keep scheduling in `sync_service`'s Rust lifecycle and persist last success, next due time, bounded backoff state, and per-source checkpoints in SQLite
- [x] 7.2 Add a single-flight coordinator that coalesces interval, hide/focus-loss, shutdown/sleep, resume, and offline-to-online triggers into at most one pending due re-check
- [x] 7.3 Apply bounded exponential backoff with jitter for transient failures, restore it across restart, and reset it only after an acknowledged success
- [x] 7.4 Bound shutdown/sleep attempts so exit cannot hang, preserve unsynced rows on timeout, and perform one catch-up check after next startup or resume
- [x] 7.5 Clear auth and stop remote scheduling on 401 while preserving local usage rows and emitting the existing re-sign-in state
- [x] 7.6 Expose compact status for enabled gates, source coverage, last attempt/success, next due time, backoff, and per-source errors without opening a hidden main window
- [x] 7.7 Add deterministic Rust tests with an injectable clock/jitter source for hourly due checks, hidden-window operation, missed-interval resume, reconnect, concurrent trigger coalescing, restart during backoff, partial source failure, and authorization loss

## 8. End-To-End Verification

- [x] 8.1 Run focused Rust tests for startup registration, lifecycle activation, usage-source normalization, scheduler/checkpoint behavior, payload privacy, and updater policy
- [x] 8.2 Run `npx tsc --noEmit`, `npm run build`, `cargo check`, and `cargo test`
- [x] 8.3 Run `BASEBUILD_E2E=1 npm run test:e2e` with mocked foreground/background launch and Settings/onboarding scenarios
- [ ] 8.4 Install a packaged Windows NSIS build and verify sign-in autostart produces a tray process with no window flash, console, terminal, or agent spawn; verify Start menu and tray activation reveal one focused window
- [ ] 8.5 Verify an installed upgrade repairs the autostart executable path without duplicates and preserves an explicit disabled preference
- [ ] 8.6 Exercise signed updater no-update, optional, mandatory, malformed-channel, and offline cases from both foreground and background launch modes
- [ ] 8.7 Exercise an opt-in hourly sync matrix covering external OMP use, Basebuild Native use, combined use, hidden window, restart, sleep/resume, offline/reconnect, server version mismatch, and 401; inspect the captured request to prove no prohibited fields leave the device
- [x] 8.8 Run Slopwatch for the completed code changes and resolve any disabled-test, suppressed-warning, empty-catch, or fake-fallback findings

## 9. Documentation And Roadmap

- [x] 9.1 Update `docs/agents/agent-runtime.md` with Windows background startup, source coverage, consent gates, scheduler semantics, and privacy boundaries
- [x] 9.2 Update `docs/agents/desktop-shell.md`, `docs/DEVELOPMENT.md`, and `docs/SECRETS.md` for hidden startup, tray activation, plugin/capability configuration, remote payload versioning, and diagnostics
- [x] 9.3 Update `docs/agents/design-system.md` and `DESIGN.md` only for user-visible first-run, Settings, tray, or update-status behavior introduced by the implementation
- [x] 9.4 Refresh `openspec/ROADMAP.md` with `node scripts/openspec-status.mjs --write` and manually reconcile the Now/Next/Proposed narrative and dependency gates
