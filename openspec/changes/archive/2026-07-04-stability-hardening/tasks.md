# Tasks: Stability Hardening

## 1. Foundation

- [x] 1.1 SQLite WAL + busy_timeout (default 5s)
- [x] 1.2 Crash report store: file-first JSON under `<app-data>/reports/`, retention 50
- [x] 1.3 Panic hook: file-first write, then emit, then chain

## 2. Crash Reports

- [x] 2.1 StabilityReport model + service (write, list, read, delete, prune, mark_seen)
- [x] 2.2 Tauri commands: list, read, delete, mark_seen, unseen_count
- [x] 2.3 Startup surfacing: unseen reports set DebugPanel badge + non-blocking notice
- [x] 2.4 DebugPanel report browser: list, view, delete, file GitHub issue; CSS; frontend tests

## 3. Telemetry

- [x] 3.1 Telemetry ring in stability_service.rs + timed! wrapper; instrument command modules; sync >50ms violations
- [x] 3.2 DebugPanel slow-command view (recent slowest, violations, DB contention)
- [x] 3.3 Rust tests: ring bounds, violation classification; wire SQLite busy-wait entries

## 4. Watchdog

- [x] 4.1 Watchdog thread: 2s heartbeat via run_on_main_thread, monotonic timing, sleep/resume suppression; freeze report at >10s
- [x] 4.2 Abort escalation at >60s (setting, default on) → final report then std::process::abort()
- [x] 4.3 Post-freeze/abort surfacing on next launch (CrashReportNotice toast + DebugPanel badge)
- [x] 4.4 Tests: freeze classification, report details, abort threshold

## 5. Timeouts & Async

- [x] 5.1 Provider client: connect 10s, stream-idle 120s; typed timeout errors; SSE-fixture tests
- [x] 5.2 Shared subprocess wall-clock timeout helper; apply to git (30s) and omp (60s)
- [x] 5.3 Migrate git commands to async + spawn_blocking
- [x] 5.4 Migrate catalog/network commands off main thread
- [x] 5.5 Chat send: event-flow migration + spawn_blocking + timeouts
- [x] 5.6 Renderer crash detection: frontend heartbeat (5s interval, 15s threshold)

## 6. Verification & Docs

- [x] 6.1 Freeze drill + crash drill: dev commands produce report/abort/surfacing
- [x] 6.2 Responsiveness smoke: 60s streaming + git diff with UI interaction; zero idle violations
- [x] 6.3 tsc --noEmit, npm run build, cargo check, cargo test
- [x] 6.4 Update docs/agents/agent-runtime.md, testing.md; refresh roadmap
