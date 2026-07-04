# Proposal: OMP <-> Basebuild IDE Sync

## Why

Basebuild Desktop already shells out to OhMyPi (OMP) for one-shot `omp stats --json` /
`omp usage --json` and a manual `sync_raw_usage` push, but the two run as strangers.
The **primary goal** is to keep the user's basebuild.net account current: the desktop app is
a producer that pushes compiled OMP usage to the basebuild.net API (the site in
`documents/repos/basebuild-dotnet`), which computes projected usage. Secondarily, while an
OMP session is running the IDE should *know* — per message — which provider plan, model, and
effort level is in play, and show a compact live view.

## What Changes

- Run OMP as a **raw terminal** tab: OMP's own interactive TUI in a PTY, fully usable, opened
  from the "+" menu. This is the preferred OMP experience and coexists with the existing
  Basebuild native chat window.
- Attach a **read-only telemetry channel** to a running OMP session by reading its
  profile-scoped local ledgers (`~/.omp/stats.db`, `~/.omp/agent/agent.db`) and `omp usage
  --json`. This surfaces per-message provider, plan, and model (effort/thinking level when
  resolvable) plus per-message metrics (tokens, cost, TTFT, duration). No prompts/source/secrets
  are ingested. (OMP's stdio RPC mode is a separate, non-terminal protocol — see design; it is
  an optional future richer path, not how the terminal tab works.)
- Add a compact live **usage view** for the running session: current model/effort, the provider
  plan in use, and live window utilization (5h/7d `usedFraction`, `resetsAt`, severity) with an
  explicit staleness marker.
- Add an opt-in **periodic account sync** loop: when signed in and enabled, the desktop pushes
  compiled OMP usage to basebuild.net (`sync_raw_usage`) roughly **hourly**, plus on
  opportunistic triggers — UI window close/hide (process still alive), impending system
  shutdown/sleep, and network reconnect (offline→online). The payload is small (aggregated
  usage only). It uses the existing native `bb_app_` token; freshness is decided from
  `get_my_live_usage.isStale`/`fetchedAgoMin` + a local cursor (the `usage-context` anchor is
  API-key only and is not depended on).
- Show the account's **projected usage** on the **Account page** (`get_my_live_usage`,
  `get_my_usage`, and optionally `list_my_plans`/`get_my_plan_timeline`), labeled with
  freshness. Display is a secondary convenience; the push to basebuild.net is the point.
- Add an **"Oh My Pi"** entry to the workspace "+" new-tab menu, shown only when OMP is
  detected installed; it opens the raw OMP terminal tab wired to the telemetry channel above.
- Keep the privacy contract: telemetry capture is local read-only; account sync is off by
  default, requires sign-in, sends usage stats only (no prompt/source/secret/absolute-path
  content), and is governed by the analytics-upload permission.

## Capabilities

### New Capabilities
- `omp-session-telemetry`: read-only, per-message provider/plan/model/effort and metrics from a
  running OMP session (local ledgers + `omp usage --json`), published to the UI.
- `omp-account-usage-sync`: opt-in, signed-in push of compiled OMP usage to basebuild.net on an
  hourly + event-driven cadence, and Account-page display of projected provider usage.
- `omp-tab-integration`: detection-gated "Oh My Pi" new-tab option that opens a raw OMP terminal
  wired to telemetry, alongside the existing native chat.

### Modified Capabilities
- (none; this repo has no archived OpenSpec specs under `openspec/specs/` yet.)

## Impact

- **Rust services:** new `omp_telemetry_service.rs` (read-only `stats.db`/`agent.db` +
  `omp usage --json` aggregation, live-context, `omp-telemetry://` events); extend
  `sync_service.rs` with the hourly + event-driven push loop and typed projected-usage reads;
  extend `terminal_service.rs`/`omp_service.rs` for the OMP PTY terminal launch.
- **Rust commands/models:** new `omp_telemetry.rs` command module and `models/omp_telemetry.rs`;
  extend `commands/sync.rs` (autosync enable/disable/status, projected-usage fetch, trigger
  reasons); register in `lib.rs`. Wire OS power/suspend and network-reachability signals.
- **Local storage/settings:** add `autoSyncUsage` (default `false`), `autoSyncIntervalMinutes`
  (default `60`), and `lastUsageSyncAt` to persisted settings.
- **Permissions:** account sync gated on sign-in + `allowUsageAnalyticsUpload`; persisting any
  telemetry metrics locally gated on `allowUsageAnalyticsCollection` (live view is ungated).
- **Frontend lib/state:** new `src/lib/ompTelemetry.ts`, `src/lib/usageSync.ts`; extend
  `src/lib/omp.ts`; new `src/state/ompTelemetry.ts` + usage-sync state hook.
- **UI:** a live usage view in the OMP terminal tab; a projected-usage section on the Account
  page; the new-tab menu gains the detection-gated "Oh My Pi" item. Uses only
  `src/styles/globals.css`, 0px radius, `title` on every interactive element.
- **Website (basebuild.net / `basebuild-dotnet`):** no change required — all reads/writes use the
  native token against `/api/mcp`. Native-token access to `/api/mcp/personal/usage-context` is an
  OPTIONAL future website enhancement, not a dependency here.
- **Docs:** update `docs/agents/agent-runtime.md`, `docs/agents/desktop-shell.md`, and `AGENTS.md`
  (tab kinds / runtime).
- **Tests/verification:** Rust unit tests for ledger parsing + freshness/trigger gating; TS build;
  manual smoke through a live OMP terminal, the usage view, opt-in autosync (hourly + triggers),
  Account-page projected usage, and the detection-gated tab.
