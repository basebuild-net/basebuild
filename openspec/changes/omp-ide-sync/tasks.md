# Tasks: OMP <-> Basebuild IDE Sync

## 1. Backend: OMP telemetry source (read-only)

- [x] 1.1 Add `src-tauri/src/models/omp_telemetry.rs`: `OmpLiveContext` (provider, plan +
  `planSource`, model, effort-or-`unknown`, session id), `OmpMessageTelemetry` (per-message
  metrics, all optional), `OmpUsageWindow` (window, usedFraction, remainingFraction, resetsAt,
  severity, measuredAt/age), and an attachment-state enum (`attached`/`detached`/`stale` + reason).
- [x] 1.2 Add `src-tauri/src/services/omp_telemetry_service.rs`: resolve the active OMP profile's
  agent dir; open `stats.db`/`agent.db` **read-only** (immutable, no write lock); parse
  per-message rows, `usage_history` plan windows, and `usage_cache:report:*` usage reports into the
  model types. Fall back to `omp stats/usage --json` when direct reads fail. No
  prompt/response/source/secret/absolute-path fields.
- [x] 1.3 Normalize into `OmpLiveContext`/`OmpMessageTelemetry`; publish updates and
  attachment-state changes over an `omp-telemetry://` event channel (add to `src-tauri/src/events.rs`).
  Poll/debounce ledger reads; emit `detached` when the session ends or ledgers become unreadable.
- [x] 1.4 Gate any local persistence of telemetry metrics on `allowUsageAnalyticsCollection`; live
  in-memory publishing is ungated.
- [x] 1.5 Add `src-tauri/src/commands/omp_telemetry.rs` (attach, detach, snapshot current context)
  and register the module + commands in `src-tauri/src/lib.rs`.

## 2. Backend: account usage sync + projected usage

- [x] 2.1 Extend `src-tauri/src/services/sync_service.rs` with typed native-token reads:
  `get_my_live_usage`, `get_my_usage`, `list_my_plans`, `get_my_plan_timeline` (JSON-RPC
  `tools/call` to `/api/mcp`), mapping results into serializable models
  (`src-tauri/src/models/usage_sync.rs`).
- [x] 2.2 Add a freshness-gated push driver: an interval tick (`autoSyncIntervalMinutes`, default
  60) plus opportunistic triggers — app window close/hide (process alive), impending system
  shutdown/sleep, and network offline→online. Every trigger re-checks gates (signed in AND
  `autoSyncUsage` AND `allowUsageAnalyticsUpload`) and freshness (local `lastUsageSyncAt` +
  `get_my_live_usage.isStale`/`fetchedAgoMin`) before calling `sync_raw_usage_native`. Do NOT call
  the API-key-only `usage-context` anchor.
- [x] 2.3 Wire OS signals: Windows power/suspend + session-end (best-effort, never block shutdown)
  and network-reachability change. Debounce triggers behind the freshness check + a minimum
  inter-sync gap; back off on failure (no retry-storm).
- [x] 2.4 Handle 401/unauthorized: clear the stored token, stop the loop, emit an auth-changed
  event so the UI prompts re-sign-in.
- [x] 2.5 Extend settings persistence (`settings_service.rs`): add `autoSyncUsage` (default
  `false`), `autoSyncIntervalMinutes` (default `60`), and `lastUsageSyncAt`.
- [x] 2.6 Add `src-tauri/src/commands/sync.rs` commands: enable/disable auto-sync, read auto-sync
  status + `lastUsageSyncAt`, and fetch projected usage on demand; register in `lib.rs`.

## 3. Backend: raw OMP terminal tab

- [x] 3.1 Add an OMP terminal launch path (reuse `terminal_service.rs` +
  `RuntimeProfile::default_omp()`) that spawns OMP's interactive TUI in a PTY in the active
  project's working directory, only on explicit user action; restore never auto-spawns. Attach the
  §1 telemetry channel to the spawned session.

## 4. Frontend: libs and state

- [x] 4.1 Add `src/lib/ompTelemetry.ts` (typed wrappers + `omp-telemetry://` listener) and extend
  `src/lib/omp.ts` as needed.
- [x] 4.2 Add `src/lib/usageSync.ts` (typed wrappers for auto-sync enable/disable/status and
  projected-usage fetch).
- [x] 4.3 Add `src/state/ompTelemetry.ts` and a usage-sync state hook; consume auth state from the
  existing `src/state/account.ts`.

## 5. Frontend: UI

- [x] 5.1 Add a live usage view to the OMP terminal tab: current provider/plan/model/effort and
  live window utilization, with staleness/detached indicators. `title` on every interactive
  element, 0px radius, `src/styles/globals.css` only.
- [x] 5.2 Add the detection-gated "Oh My Pi" entry to `src/components/layout/WorkspaceTabs.tsx`
  (shown when `omp_status().installed`; hidden or disabled+tooltip otherwise); wire `onCreateTab`
  for the OMP terminal tab.
- [x] 5.3 Add the projected-usage view to the **Account page** (Settings > Account / account
  panel): per-provider window utilization (used/remaining, resets-at, severity) and per-model
  requests/day + hours/day, each labeled with freshness; server-stale values shown as stale.
- [x] 5.4 Add the auto-sync toggle (available only when signed in) plus last-sync status, a
  "Sync now" action, and a compact non-blocking failure status. Surface exactly what is sent.

## 6. Verification & docs

- [x] 6.1 Rust unit tests: `stats.db`/`agent.db` read-only parsing into the telemetry models;
  freshness + trigger gate logic (off when logged out / toggle off / upload denied; skip when
  fresh; debounce). Assert no prompt/source/secret/absolute-path fields ever populate the models.
- [x] 6.2 `npx tsc --noEmit` clean; targeted TS checks for new libs/state/UI.
- [ ] 6.3 Manual smoke: raw OMP terminal tab shows per-message provider/plan/model/effort + window
  utilization; opt-in autosync pushes hourly and on hide/shutdown/reconnect, skips when fresh;
  Account-page projected usage renders with freshness; "Oh My Pi" appears only when OMP is
  installed and opens a telemetry-wired raw terminal.
- [x] 6.4 Update `docs/agents/agent-runtime.md` (telemetry + account sync + triggers),
  `docs/agents/desktop-shell.md` (tab kinds + new-tab menu), and `AGENTS.md` where tab
  kinds/runtime are described.

## Verification notes

Automated coverage (2026-07-03, native-agent-loop phase 1):
- OMP tab detection + telemetry HUD rendering and Account-page projected usage + auto-sync toggle UI verified via `tests/e2e/omp-sync.spec.ts` (2 tests). All e2e pass.
- Backend telemetry parsing + freshness/trigger gate logic covered by Rust unit tests in `omp_telemetry_service.rs` (cargo test, 97 tests pass).
- 6.3 remains partially manual: the live autosync trigger matrix (window hide, system shutdown, network offline→online) and per-message telemetry from a real running OMP session require a live OMP install + running Tauri app — not statically verifiable.
