# Design: OMP <-> Basebuild IDE Sync

## Context

Basebuild Desktop already has the building blocks but no live integration:

- `omp_service.rs` — probes `omp --version` (`status`), runs `omp <args> --json` (`run_json`),
  and streams a one-shot command over `omp://event` (`stream_command`).
- `terminal_service.rs` — PTY-backed terminal spawning.
- `sync_service.rs::sync_raw_usage_native()` — collects `omp stats --json` + `omp usage --json`
  and POSTs a `sync_raw_usage` JSON-RPC `tools/call` to `https://basebuild.net/api/mcp` with the
  stored native `bb_app_` token. One-shot, manual (command `sync_raw_usage_native`).
- `auth_service.rs` — device-flow login storing a native token + profile in `~/.basebuild/auth.json`.
- `RuntimeProfile::default_omp()` — an OMP profile already exists in the profile model.
- `WorkspaceTabs.tsx` — the "+" menu offers Terminal / Schematic / Chat.

OMP data sources:

- **Local ledgers** (profile-scoped, `docs/config-usage.md`): `~/.omp/stats.db` (per-message
  ledger; the `messages` GROUP BY shape the website already ingests) and `~/.omp/agent/agent.db`
  (`usage_history` plan windows, `auth_credentials`, `cache` with `usage_cache:report:*` live
  provider usage). `omp stats --json` / `omp usage --json` are the aggregate CLI views.
- **RPC mode** (`omp --mode rpc`, `docs/rpc.md`): newline-delimited JSON over **stdio**. Rich —
  `get_state` (`model.{provider,id}`, `thinkingLevel`, `isStreaming`, `sessionId`), live agent
  events, and a full command surface (`prompt`, `set_model`, …). But it is a machine protocol,
  **not** an interactive terminal: a process is EITHER a raw TUI terminal OR an RPC endpoint on
  its stdio, never both. `collab` (`docs/collab.md`) can mirror live events from a running TUI
  session but needs a websocket relay.

Website MCP auth (`basebuild-dotnet`, `src/lib/auth/bearer-resolver.ts`): `POST /api/mcp`
accepts both `bb_live_` API keys and `bb_app_` native tokens; native tokens are scope-gated to
`mcp:usage`, which covers every usage tool used here (`sync_raw_usage`, `get_my_usage`,
`get_my_live_usage`, `get_my_plan_timeline`, `get_my_session_usage`, `list_plans`,
`list_my_plans`, `get_my_sync_history`, `declare_usage_profile`). The auto-sync anchor
`GET /api/mcp/personal/usage-context` is `resolveApiKey`-only (API keys), so a native token 401s
there — it is deliberately not used.

## Goals / Non-Goals

**Goals**:
- Keep the user's basebuild.net account current by pushing compiled OMP usage (the primary
  purpose; the desktop app is the producer, the website computes projected usage).
- Run OMP as a raw terminal tab and, alongside it, show per-message provider/plan/model/effort +
  metrics and live provider window utilization, read-only.
- Opt-in, signed-in, hourly + event-driven sync over the existing native token; Account-page
  display of projected usage.
- A detection-gated "Oh My Pi" new-tab option. Preserve the privacy contract.

**Non-Goals**:
- No website/backend change is required for the desktop path (all via the native token on
  `/api/mcp`). Native-token support for `usage-context` is optional future work in `basebuild-dotnet`.
- No `declare_usage_profile` UI: the IDE already lets the user pick model + effort; we only sync
  usage data and let the website derive.
- No RPC-driven native OMP surface in this change (optional future, see Q4 below). No fully
  native terminal replacement — low benefit; explicitly out of scope.
- No writing to OMP's databases or mutating a running OMP session.

## Decisions

### Decision: Read-only ledger telemetry is the primary and only telemetry source in scope

**Decision**: Telemetry comes from read-only reads of the profile-scoped `stats.db`/`agent.db`
plus `omp usage --json`, normalized by `omp_telemetry_service.rs` into an `OmpLiveContext` /
`OmpMessageTelemetry` shape and republished over `omp-telemetry://`. This applies equally to an
IDE-spawned OMP terminal and an externally running OMP.

**Rationale**: It works alongside a raw OMP TUI terminal (which owns stdio), covers external
sessions, and needs no relay. OMP stays the source of truth (AGENTS.md "Respecting underlying
tools").

**Alternatives**: RPC (`omp --mode rpc`) gives event-driven `get_state`/`thinkingLevel` with no
polling — but it is not a terminal, so it cannot back the raw-terminal tab the user wants.
Collab mirrors a live TUI session but needs a websocket relay. Both are heavier; deferred.

### Decision: Q4 — "Oh My Pi" tab is a raw PTY terminal; RPC is optional future work

**Decision**: The "Oh My Pi" tab runs OMP's interactive TUI in a PTY (raw terminal the user
types into), reusing `terminal_service.rs` + `RuntimeProfile::default_omp()`, spawned only on
explicit selection. The app reads its telemetry from the ledgers (above). The existing Basebuild
native chat window stays. An RPC-backed native OMP surface (drive OMP via `omp --mode rpc` and
render frames natively for zero-lag live state) is recorded as an optional future enhancement, not
built here. A fully native terminal is out of scope (low benefit).

**Rationale**: This matches the stated preference — "OMP terminal raw with RPC to our app and
also our native chat window" — within the hard constraint that RPC mode and a raw TUI terminal
are mutually exclusive on one process. "RPC to our app" is honored in spirit by the live
telemetry channel; true RPC transport is a later, additive path if event-driven state is wanted.

**Alternatives**: Make the "Oh My Pi" tab an RPC-native rendering instead of a raw terminal —
rejected because the user prefers the raw OMP TUI.

### Decision: Q2 — hourly interval plus opportunistic triggers

**Decision**: The push loop ticks every `autoSyncIntervalMinutes` (default 60) and additionally
fires on: app window close/hide while the process stays alive; impending system shutdown/sleep;
and network offline→online transitions. Every trigger re-checks the gates (signed in + auto-sync
on + `allowUsageAnalyticsUpload`) and the freshness check before pushing. The payload is small
(aggregated usage), so extra triggers are cheap.

**Rationale**: Matches the requested cadence and keeps the account current around the moments a
periodic timer would miss (app going idle, machine going down, connectivity returning) without
storming. On Windows, power/suspend and session-end signals are available to the shell; network
reachability is observable.

**Alternatives**: Interval-only — misses shutdown/reconnect and leaves the account stale after
long idle/offline stretches. Push-on-every-message — needless traffic for aggregated data.

### Decision: All account I/O over the native token on `/api/mcp`; freshness from `get_my_live_usage`

**Decision**: Extend `sync_service.rs` with typed native-token reads (`get_my_live_usage`,
`get_my_usage`, `list_my_plans`, `get_my_plan_timeline`) and the freshness-gated push. Freshness
= local `lastUsageSyncAt` cursor + `autoSyncIntervalMinutes` and `get_my_live_usage.isStale` /
`fetchedAgoMin`. Do not call the API-key-only `usage-context` anchor.

**Rationale**: The native token already works at `/api/mcp` for every usage tool, and
`get_my_live_usage` returns the same staleness signal the anchor's `shouldSync` provides — so the
desktop path is self-contained with no website change and no second credential.

### Decision: Q1 — push is primary; projected usage shown on the Account page

**Decision**: The point of the feature is sending compiled usage to basebuild.net. The in-app
projected-usage view is a secondary convenience placed on the Account page (Settings > Account /
account panel), not a separate side-panel section.

**Rationale**: Keeps the desktop surface minimal and puts account-derived data where account
state already lives, next to sign-in/sign-out and the auto-sync toggle.

### Decision: Q3 — no plan/effort declaration UI

**Decision**: Do not add `declare_usage_profile` UI. The IDE already selects model + effort; this
change only syncs usage data and lets the website compute projections.

**Rationale**: Avoids duplicating existing selection UI and scope creep; the website derives from
the raw blobs.

### Decision: Privacy gating split — live view vs. persistence vs. upload

**Decision**: Live in-memory telemetry display needs no permission (read-only, ephemeral).
Persisting telemetry metrics locally requires `allowUsageAnalyticsCollection`. Uploading usage to
the account requires sign-in + `autoSyncUsage` + `allowUsageAnalyticsUpload`. No prompt, response,
source, terminal, secret, or absolute-path content is ever captured or sent.

**Rationale**: Matches the existing three-way analytics stance (collection vs upload separate,
both off on fresh install) while still letting a logged-out user see live context.

## Risks / Trade-offs

- **OMP ledger schema drift** → Treat `stats.db`/`agent.db` as external contracts: version-tolerant
  parsing, `unknown` for unresolved fields, no zero-fill. Pin observed shapes in tests; fall back
  to `omp stats/usage --json` (already the sync contract) when direct reads fail.
- **SQLite contention with a live OMP writer** → Read-only/immutable connections, short reads,
  never hold a lock; fall back to the JSON command path on failure.
- **Perceived phone-home** → Default off; sign-in + explicit toggle + upload permission required;
  usage-only payload; surface exactly what is sent on the Account page.
- **Shutdown/sleep push may not complete** → Treat power/session-end sync as best-effort; never
  block shutdown; the next successful trigger reconciles.
- **Trigger storms (rapid online/offline flaps, repeated hide/show)** → Debounce triggers behind
  the same freshness check and a minimum inter-sync gap; back off on failure.
- **Effort/plan ambiguity** → OMP does not persist a per-request thinking level everywhere; report
  `unknown` rather than guessing; prefer explicit session `thinking_level_change` metadata.

## Migration Plan

Additive only. New services/commands/settings; no schema break to existing tables. Rollout:

1. Land the read-only telemetry path + `omp-telemetry://` events (no UI dependency).
2. Add the raw OMP terminal tab (detection-gated menu) + the live usage view.
3. Add the freshness-gated push loop (hourly + triggers) + typed projected-usage reads + the
   auto-sync toggle (default off).
4. Wire the Account-page projected-usage display.

Rollback: disable the auto-sync setting (default already off) and hide the usage view / menu
entry; the manual `sync_raw_usage_native` command and existing OMP commands remain unchanged.

## Open Questions

- Best-effort shutdown/sleep sync on Windows: which signal is most reliable for a windowed Tauri
  app (WM_QUERYENDSESSION / power-suspend broadcast) and how much time is realistically available
  before termination?
- Should the RPC-backed native OMP surface be scheduled as an immediate follow-up change, or left
  as a documented possibility until there is demand for zero-lag live state?
