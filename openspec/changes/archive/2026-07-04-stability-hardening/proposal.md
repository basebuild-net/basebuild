# Proposal: Stability Hardening

## Why

The app is architecturally allowed to hang: 141 of 149 Tauri commands are sync (main-thread execution), heavy paths (`native_chat_send` blocking SSE, 15 git commands, catalog sync) run network/subprocess I/O on the event loop, and zero timeouts exist in `provider_client.rs`, `git_service.rs`, or `omp_service.rs` — a stalled socket freezes the app indefinitely with no report. The panic hook can deadlock on `APP_HANDLE.lock()` during crash reporting, panic reports are emitted but never persisted, renderer (black-screen) crashes bypass JS handlers entirely, and SQLite runs without WAL or busy_timeout while writer threads multiply. Freezes must become fast, reported crashes; slow paths must leave the main thread; every hang must produce an artifact instead of a reproduction hunt.

## What Changes

- Migrate network/git/heavy commands off the main thread (async + `spawn_blocking`); `native_chat_send` returns immediately and streams entirely via events; add outbound timeouts everywhere (provider stream-idle, git, omp subprocesses).
- Add command-duration telemetry: every command records name + duration to an in-memory ring buffer; sync commands exceeding a threshold log a violation; DebugPanel shows the slowest recent commands.
- Add a freeze watchdog: heartbeat thread measures main-thread responsiveness; unresponsive beyond a report threshold writes a freeze report to disk (last/pending commands, uptime); beyond an abort threshold (configurable, default on) the process aborts so a hang becomes a crash artifact.
- Harden crash reporting: panic hook writes a crash file to disk before any lock/emit (`try_lock` only), renderer-process death is detected with a relaunch prompt, and DebugPanel gains a crash/freeze report browser with user-triggered GitHub issue creation. Local-first: nothing uploads automatically.
- Make SQLite robust: WAL journal mode, `busy_timeout` on every connection, and a write-contention audit across services.

## Capabilities

### New Capabilities

- `main-thread-hygiene` — async/off-thread execution for heavy commands, outbound timeouts, command-duration telemetry.
- `freeze-watchdog` — main-thread liveness monitoring, freeze reports, hang-to-crash escalation.
- `crash-reporting` — persisted panic/freeze/renderer-crash reports, deadlock-free hook, report browser, user-triggered issue filing.
- `sqlite-robustness` — WAL, busy timeouts, contention audit.

### Modified Capabilities

- None canonical. Complements the unarchived `strong-testing-suite` (its modified `desktop-shell` requirement asserts crash diagnostics exist; this change builds them — land this first or together).

## Impact

- `src-tauri/src/lib.rs` (panic hook rewrite, watchdog startup), new `services/stability_service.rs` (watchdog, reports, command telemetry), `services/storage_service.rs` (pragmas), `provider_client.rs` (timeouts), `git_service.rs`/`omp_service.rs` (subprocess timeouts), `commands/*` (async migration of network/git/heavy commands), `commands/native_chat.rs` + `native_chat_service.rs` (event-only send).
- `src/lib/native-chat.ts` (send flow becomes event-completion based), `src/lib/stability.ts` (reports, telemetry), `DebugPanel.tsx` (report browser, slow-command view), `ErrorBoundary.tsx` (freeze/crash report links), `globals.css`.
- Crash/freeze report files under the app data directory; additive settings keys (thresholds, abort toggle).
- Coordination: `native_chat_service.rs`/`provider_client.rs` are touched by agent A and superseded in part by `native-agent-loop`'s dedicated-thread loop — the chat-send migration phase must sequence with those merges; watchdog/crash/SQLite phases are independent and can start immediately.
- Docs: `docs/agents/agent-runtime.md`, `docs/DEVELOPMENT.md` (report locations, thresholds), `DESIGN.md` (DebugPanel additions).
