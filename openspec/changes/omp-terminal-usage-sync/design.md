# Design: OMP Terminal & Usage Sync Readiness

## Context

Installed build v0.0.12 tested live on 2026-07-05 with computer-use
driving the real UI, DB inspection of `~/.basebuild/state.db`, and process
inspection. Evidence per defect:

- **Terminal dead**: OMP tabs and a plain Terminal tab each spawned their
  backend process (`omp.EXE` ×2 + `powershell.exe`, each with a headless
  `conhost --width 80 --height 24` — confirmed via
  `Win32_Process ParentProcessId=30496`), but xterm rendered zero bytes,
  input produced no echo, and the log panel recorded nothing. The PTY
  layer works; the break is between PTY output and the webview (event
  emit/listen or xterm attach), and resize is never applied (stuck at
  80x24 spawn defaults).
- **"Sync now" silent**: two clicks → no UI feedback, `usage_sync_settings`
  stayed empty. `trigger_sync` starts with `if !gates_pass() { return; }`;
  `gates_pass()` requires `auto_sync_usage` (default false) and
  `allow_usage_analytics_upload` (default false), so manual sync is
  unreachable on a default profile even when signed in — contradicting the
  canonical spec's "manual sync remains available on demand".
- **Telemetry always detached**: `omp usage --json` (omp 16.3.6) returns
  `reports[].limits[]` with rich window data; `parse_windows` looks for
  top-level `windows`/`usage` arrays only → empty → "Detached: No OMP
  session data found" despite a live OMP install. Meanwhile the projected
  usage table (server-side data via MCP) renders fine.
- **Skills missing**: `C:\Users\user\AppData\Local\Basebuild\` contains
  only the exe + uninstaller; no `resources/skills`. `read_skill`'s
  production fallback path can never resolve.
- **Chat/session clutter**: every launch mints a session with a timestamp
  title and a default "Chat 1" tab; the owner's sidebar shows 55+ sessions
  whose chats are almost all empty (65+ sessions in DB, 55 native chat
  sessions). Also being fixed structurally in `planning-system-qol`; this
  change adds the terminal-first and empty-chat-hygiene requirements.

## Goals / Non-Goals

**Goals**:
- Day-one OMP workflow on the installed build: open project → OMP tab runs
  the TUI visibly → usage syncs to basebuild.net by default → plan
  generator reachable.
- No silent outcomes anywhere in the sync path.
- Diagnosis-first: tasks below name the suspected mechanism so the
  implementer verifies the specific break, not a rewrite.

**Non-Goals**:
- Website API changes (`sync_raw_usage` + cron ingestion already exist and
  match).
- Plan-generation pipeline changes (owned by `planning-system-qol`).
- General analytics event taxonomy changes (`privacy-usage-analytics`
  stays; only usage-sync-related permission defaults flip).

## Decisions

- **Decision**: Treat sign-in as the consent action for usage sharing and
  flip `auto_sync_usage`, `allowUsageAnalyticsUpload`, and
  `allowUsageAnalyticsCollection` defaults to on-after-sign-in
  (fresh-signed-out installs still sync nothing). **Rationale**: owner
  directive for their own product+site; sync is technically impossible
  without an account, so sign-in is a natural consent boundary; opt-out
  stays one click. **Alternatives**: first-run modal checkbox (extra
  friction the owner explicitly doesn't want); silent always-on (violates
  no-silent-side-effects — rejected). AGENTS.md privacy language must be
  amended in the same PR; sign-in UI copy must disclose the default.
- **Decision**: Split gates: periodic sync keeps
  signed-in + enabled + upload-permission; manual sync requires only
  signed-in + upload-permission and skips the freshness check.
  **Rationale**: matches canonical spec intent; a human clicking a button
  IS the freshness signal. **Alternatives**: single gate set (reproduces
  the current dead button).
- **Decision**: Terminal fix is diagnose-then-repair on the output event
  path: verify PTY reader thread emits, verify event name/window-label
  targeting matches the webview listener, verify xterm `open()`/write
  wiring and the collapsed-by-default terminal section (the "+ Terminal
  #N" header suggests the xterm container may mount collapsed/zero-height,
  which can also break fit/resize). Add a byte-level tracing hook behind
  the debug panel while fixing. **Rationale**: spawn side is proven good;
  rewriting the PTY layer is unjustified. **Alternatives**: swap PTY crate
  (no evidence it's at fault).
- **Decision**: Telemetry parser gains a versioned-shape chain
  (16.x `reports[].limits[]` first, then legacy shapes) plus an explicit
  parse-mismatch state carrying `omp --version`. **Rationale**: schema
  drift will recur; naming the version turns future drift into a
  one-glance diagnosis. **Alternatives**: pin to one shape (breaks again
  on the next omp release).
- **Decision**: Bundle `skills/` via Tauri `resources` config; keep the
  existing dev-path fallback; add a `list_skills` command for enumeration.
  **Rationale**: smallest packaging fix; enumeration unblocks future
  website skill-sync without hardcoding. **Alternatives**: embed skills in
  the binary (loses hot-editability in dev).
- **Decision**: Lazy chat creation: project open creates only the project
  session shell; the default workspace tab is a neutral schematic/empty
  state (already required by `desktop-runtime-processes`); native chat
  rows are created on first chat interaction. **Rationale**: directly
  eliminates the empty-chat pile-up at its source. **Alternatives**:
  auto-pruning empty chats on exit (treats the symptom; still churns ids).

## Risks / Trade-offs

- Default-on sync will surprise privacy-sensitive users → Mitigation:
  disclosure in the sign-in surface, one-click opt-out, payload remains
  aggregated-usage-only (canonical "Usage-only payload" requirement is
  unchanged and already implemented).
- Terminal fix touches the hot path for all terminals → Mitigation: e2e
  coverage asserting echoed output for a scripted PTY session; freeze-drill
  re-run after the fix.
- `session-lifecycle` capability lands in `planning-system-qol` →
  Mitigation: ordering note in ROADMAP; if this change is applied first,
  its `session-lifecycle` delta stands alone as the capability's first
  requirements (both changes' deltas are additive and non-conflicting).

## Migration Plan

1. Permission/settings defaults change applies to profiles that have never
   explicitly set the values (missing-row semantics); users who previously
   unchecked anything keep their explicit choice.
2. Skills bundling is a packaging-only change; no data migration.
3. Rollback: revert defaults to false; terminal/telemetry fixes have no
   schema impact.

## Open Questions

- Should the OMP tab auto-reconnect (respawn omp) on click when restored
  disconnected, or require an explicit "Reconnect" button? Canonical spec
  says explicit action; recommend a single "Reconnect" button in the
  disconnected state.
- Whether `allowUsageAnalyticsCollection` default-on should also enable
  the local analytics event ledger, or only the OMP telemetry ledger —
  recommend scoping the flipped default to usage-sync surfaces and leaving
  the analytics event ledger opt-in until the owner says otherwise.
