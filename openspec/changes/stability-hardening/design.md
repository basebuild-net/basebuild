# Design: Stability Hardening

## Context

Evidence from analysis (2026-07-03): 141/149 sync commands (main-thread execution in Tauri v2); `native_chat_send`/`native_generate_ideas`/catalog sync do blocking reqwest on the event loop; zero timeouts in `provider_client.rs`/`git_service.rs`/`omp_service.rs`; panic hook takes `APP_HANDLE.lock()` (deadlock risk in the reporter itself) and only emits events (reports lost with dead webview); `StorageService::connect` sets no pragmas; nothing monitors main-thread liveness; renderer death bypasses `ErrorBoundary`. Correct patterns already exist to copy: `thread::spawn` streaming in omp/terminal/sync services, `spawn_blocking` in `projects.rs`.

## Goals / Non-Goals

**Goals**: no code path can freeze the app silently; every hang/crash produces a disk artifact; main thread does UI dispatch only; app feels fast because nothing heavy runs on it.

**Non-Goals**: automatic crash upload (local-first — filing is user-triggered); minidump/native-debugger integration (Rust backtrace + telemetry ring suffices for v1); frontend performance work (rendering, memoization) beyond unblocking the main thread; replacing the send flow that `native-agent-loop` will own (coordinate, don't duplicate).

## Decisions

**Decision**: `stability_service.rs` owns watchdog, telemetry ring, and report store. Watchdog thread posts a heartbeat closure to the main thread (`app.run_on_main_thread`) every 2s and measures completion; report at >10s unresponsive, abort at >60s (setting `stability.abortOnFreezeSecs`, default on). Abort path: write report → `std::process::abort()`. — **Rationale**: roundtrip-through-main measures the thing users feel; abort converts zombies into artifacts, which is the change's core promise. **Alternatives**: OS-level "not responding" detection — platform-specific and later than a heartbeat.

**Decision**: Command telemetry via a wrapper installed in each command body (small macro `timed!("name", || …)`) writing to a lock-free ring (fixed 512 entries) in `stability_service`. Sync >50ms = violation entry. Freeze reports embed the last N entries — that's how a report names the blocking command. — **Rationale**: cheapest instrumentation that makes both slowness and freezes attributable; a proc-macro over all commands is nicer but heavier — revisit after migration shrinks the sync set.

**Decision**: Panic hook rewrite: build report string → write file (path precomputed at startup, no locks) → `APP_HANDLE.try_lock()` for best-effort event emit. Crash dir: `<app-data>/reports/` shared by panic/freeze/renderer reports, JSON files, retention 50. — **Rationale**: file-first ordering makes reports survive every failure mode including reporter deadlock (eliminated by try_lock) and dead webview.

**Decision**: Renderer crash detection: listen for webview process termination via Tauri v2 window/webview events; on abnormal termination write report + recreate the webview window (backend state lives in Rust/SQLite, so relaunch is cheap). Exact event surface (wry/WebView2 `ProcessFailed` mapping) is an implementation-time investigation task with a fallback: frontend heartbeat (webview pings backend every 5s; missed pings + window alive = renderer wedged/dead). — **Rationale**: fallback guarantees the capability even if the platform event isn't exposed cleanly.

**Decision**: Async migration order: (1) git commands (self-contained, `spawn_blocking` + 30s timeout), (2) catalog/network commands (async reqwest or `spawn_blocking` around blocking client, connect 10s), (3) `native_chat_send` → returns turn handle, worker thread streams and emits existing `NATIVE_CHAT_CHUNK` + new completion event; frontend `sendMessage` awaits the completion event. Phase (3) sequences with agent A / `native-agent-loop` since that change moves turns onto dedicated threads anyway — if the agent-loop lands first, (3) reduces to verifying its thread model + adding timeouts. — **Rationale**: independent wins first; no duplicate rework of the send path.

**Decision**: Provider timeouts: connect 10s; stream-idle 120s implemented as read-timeout on the blocking client (per-read deadline), not whole-request timeout (turns legitimately run minutes). Git/omp subprocess: wall-clock kill via the existing `process_helpers` + `taskkill /T /F` pattern specced in `native-agent-loop` — share one helper.

**Decision**: SQLite: `PRAGMA journal_mode=WAL` (sticky, set once at startup + idempotent per connect) and `busy_timeout=5000` per connect in `StorageService::connect`; busy-wait >250ms recorded into telemetry via rusqlite busy handler wrapping. — **Rationale**: WAL gives readers-don't-block-writer; busy_timeout absorbs writer bursts from the new queue/telemetry threads.

## Risks / Trade-offs

- **Watchdog false positives** (nested modal event loops, OS sleep/resume) → heartbeat uses monotonic clock, suspends detection across resume events, and report-before-abort thresholds are generous (10s/60s defaults).
- **Abort-on-freeze kills a busy-but-alive app** (pathological but progressing main-thread work) → abort only when heartbeats fail continuously, not on cumulative slowness; setting can disable.
- **Async migration churn across 15+ command signatures** → frontend wrappers unchanged (invoke is already promise-based); migrate module-by-module with `cargo check` gates.
- **Agent A collision on `native_chat_service.rs`** → phase ordering puts chat-send last; all other phases touch files agent A doesn't own.
- **WAL leaves `-wal`/`-shm` files** → harmless; document in DEVELOPMENT.md.

## Migration Plan

1. SQLite pragmas + contention telemetry (no schema changes, instant win).
2. Report store + panic hook rewrite + DebugPanel browser.
3. Watchdog (report-only first, abort default-on after a soak week behind setting).
4. Timeouts + git/network async migration.
5. Chat-send event-flow migration, sequenced with `native-agent-loop` merge state.

Rollback: every piece is setting-gated or additive; watchdog abort and telemetry can be disabled at runtime; pragmas are backward-compatible.

## Open Questions

- Exact Tauri v2 API for WebView2 `ProcessFailed` — investigate; fallback heartbeat specced.
- Should freeze reports capture native stack of the main thread (requires platform APIs)? v1 ships command-attribution only; revisit if reports prove insufficient.
- Violation threshold (50ms) may need tuning on slower disks — make it a setting from day one.
