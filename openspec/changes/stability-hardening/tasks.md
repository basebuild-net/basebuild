# Tasks: Stability Hardening

## 1. SQLite Robustness

- [ ] 1.1 `StorageService::connect`: WAL (startup + idempotent per-connect) and `busy_timeout(5000)`; busy handler records waits >250ms into telemetry once the ring exists (wire in phase 3).
- [ ] 1.2 Rust tests: concurrent writer threads produce no locked errors; pragmas verified on fresh and existing databases.

## 2. Crash Report Store & Panic Hook

- [ ] 2.1 `stability_service.rs`: report store — JSON reports (panic/freeze/renderer) under `<app-data>/reports/`, retention 50, list/read/delete API.
- [ ] 2.2 Panic hook rewrite in `lib.rs`: precomputed report path, file-first write with no lock acquisition, `try_lock` best-effort `rust://panic` emit; unit test the formatter, manual panic smoke for the file path.
- [ ] 2.3 Startup surfacing: unseen reports set a DebugPanel badge + non-blocking notice.
- [ ] 2.4 DebugPanel report browser: list, full view, delete, "file GitHub issue" opening prefilled browser URL; tooltips; `globals.css` only; frontend tests (mocked Tauri).

## 3. Command Telemetry

- [ ] 3.1 Fixed-size telemetry ring in `stability_service.rs` + `timed!` wrapper; instrument all command modules; sync >50ms violations (threshold setting).
- [ ] 3.2 DebugPanel slow-command view (recent slowest, violations, DB contention entries).
- [ ] 3.3 Rust tests: ring bounds, violation classification; wire SQLite busy-wait entries from 1.1.

## 4. Freeze Watchdog

- [ ] 4.1 Watchdog thread: 2s heartbeat via `run_on_main_thread`, monotonic timing, sleep/resume suppression; freeze report at >10s embedding recent telemetry (in-flight command attribution).
- [ ] 4.2 Abort escalation at >60s (`stability.abortOnFreezeSecs`, default on; report-only mode when disabled) → final report then `std::process::abort()`.
- [ ] 4.3 Post-freeze/abort surfacing on next launch (reuses 2.3).
- [ ] 4.4 Tests: deliberate main-thread block in dev harness produces report (and abort when enabled); soak run produces zero false positives.

## 5. Timeouts & Async Migration

- [ ] 5.1 Provider client: connect timeout 10s, per-read stream-idle timeout 120s; typed timeout errors named in transcript; SSE-fixture tests.
- [ ] 5.2 Shared subprocess wall-clock timeout helper in `process_helpers` (kill process tree; align with `native-agent-loop`'s helper); apply to git (30s) and omp (60s) invocations.
- [ ] 5.3 Migrate git commands to async + `spawn_blocking`; verify SourcePanel behavior unchanged; no frontend wrapper changes.
- [ ] 5.4 Migrate catalog/network commands (`native_catalog_sync`, catalog refresh, login poll) off the main thread.
- [ ] 5.5 Chat send: `native_chat_send` returns turn handle; worker thread streams `NATIVE_CHAT_CHUNK` + completion event; `src/lib/native-chat.ts` awaits completion event. **Sequence with agent A / `native-agent-loop` merge state — skip if the agent-loop thread model already covers it, then only add timeouts + verify.**
- [ ] 5.6 Renderer crash detection: investigate Tauri v2 webview-termination events; implement platform event or fallback frontend heartbeat (5s ping, missed-ping + alive window = renderer report + relaunch offer).

## 6. Verification & Docs

- [ ] 6.1 Freeze drill: dev-only command that blocks the main thread → report written, abort fires, next launch surfaces it. Crash drill: dev-only panic → file exists, issue prefill correct.
- [ ] 6.2 Responsiveness smoke: 60s streaming turn + git diff on large repo with UI interaction throughout; zero violations from idle app.
- [ ] 6.3 `npx tsc --noEmit`, `npm run build`, `cargo check`, `cargo test`.
- [ ] 6.4 Update `docs/agents/agent-runtime.md`, `docs/DEVELOPMENT.md` (report dir, thresholds, WAL files), `DESIGN.md` (DebugPanel states); refresh roadmap via `node scripts/openspec-status.mjs --write`.
