# Proposal: OMP Terminal & Usage Sync Readiness

## Why

Live testing of the installed build (v0.0.12, 2026-07-05, project
`basebuild-dotnet`, signed in as the owner account) shows the day-one OMP
workflow is broken end-to-end: OMP terminals spawn `omp.exe` backend-side
but render nothing, telemetry always reads "Detached", and "Sync now"
silently does nothing because manual sync is (incorrectly) gated behind the
auto-sync toggle and off-by-default permissions. The owner's target
workflow — run ohmypi inside the app, have usage data sync to basebuild.net
regularly by default, and use the plan generator — fails at every step.
This change is diagnosis-complete: each defect below was reproduced live
and traced to a specific mechanism.

## What Changes

Implementation gaps against existing canonical specs (no new requirements):

- **P0 — terminal output plumbing dead in packaged build**: creating an OMP
  tab or plain Terminal tab spawns the backend process correctly (verified:
  `omp.EXE` + headless `conhost` 80x24 children of `basebuild-app.exe`, and
  `powershell.exe` for plain terminals) but the xterm surface never renders
  a single byte; keystrokes produce no echo; no error is logged or
  surfaced. Fix the PTY output event delivery → xterm attach path, input
  path, and resize (PTY stays at spawn-default 80x24). Implements
  `omp-tab-integration` ("Oh My Pi opens a raw OMP terminal tab") and
  `desktop-runtime-processes` (explicit terminal action attaches an
  internal PTY).
- **Restored terminal tabs pretend to be live**: a restored "Terminal 60"
  tab renders an empty expandable terminal with a cursor instead of the
  required disconnected state (`omp-tab-integration` restore scenario,
  `ide-workspace-state` stale-tab scenario).
- **Manual sync must not require auto-sync**: `sync_service::trigger_sync`
  returns early via `gates_pass()` (signed-in AND `auto_sync_usage` AND
  `allow_usage_analytics_upload`) even for the manual "Sync now" button —
  but the canonical `omp-account-usage-sync` spec says manual sync "remains
  available on demand" when auto-sync is off. Manual sync gets its own
  gate set (signed-in AND upload permission only).

New/modified requirements (spec deltas in this change):

- **Usage sharing on by default** (**BREAKING** vs current privacy
  defaults, owner-directed): once signed in, auto-sync defaults to enabled
  (checkbox pre-checked), and the usage-sync-related permissions
  (`allowUsageAnalyticsUpload`, `allowUsageAnalyticsCollection`) default to
  granted. Sign-in is the consent action; opt-out remains one click.
  MODIFIES `omp-account-usage-sync` "Opt-in, signed-in account sync";
  requires AGENTS.md / docs privacy-language updates in the same change.
- **Sync feedback is mandatory**: every sync attempt (manual or automatic)
  must end in a visible outcome — success with timestamp, error with
  reason, or "blocked: <gate>" — never a silent return. Observed: two
  "Sync now" clicks with zero UI feedback and no DB trace. ADDED to
  `omp-account-usage-sync`.
- **Telemetry parser tolerates omp schema versions**: the HUD shows
  "Detached: No OMP session data found" while `omp usage --json` (omp
  16.3.6) returns rich data — the parser expects top-level
  `windows`/`usage` arrays, but omp now emits `reports[].limits[]`.
  Parse current schemas, and when parsing fails, surface "telemetry
  format not recognized (omp X.Y)" instead of a generic detached state.
  ADDED to `omp-session-telemetry`.
- **Skills ship with the app**: the installed bundle has NO
  `resources/skills` directory, so `read_skill` fails for all four repo
  skills (`basebuild-autonomous`, `basebuild-idea-generation`,
  `basebuild-project-schematic`, `basebuild-session-title`) in production.
  Bundle skills into the installer, keep them readable at runtime, and
  surface load failures. NEW capability `skills-distribution`.
- **Terminal-first sessions**: opening a project and running terminals
  (including OMP tabs) must not create chat sessions or native-chat rows;
  chat state is created lazily when the user first opens/uses a chat tab.
  Empty never-used auto-created chats must not accumulate. ADDED to
  `session-lifecycle` (capability introduced by the in-flight
  `planning-system-qol` change — ordering dependency noted in design).

QoL (tasks only):

- Settings → Updates shows "Installed — / Latest —" alongside "You're on
  the latest version"; meanwhile a dev-build header offered "Update 0.0.11"
  while the installed build is 0.0.12. Make the updater panel show real
  installed/latest versions and never offer downgrades.

## Capabilities

### New Capabilities

- `skills-distribution` — packaging and runtime availability of bundled
  skills.

### Modified Capabilities

- `omp-account-usage-sync` — MODIFIED: "Opt-in, signed-in account sync" →
  default-on after sign-in; ADDED: mandatory sync outcome feedback.
- `omp-session-telemetry` — ADDED: schema-version-tolerant parsing with
  explicit parse-failure surfacing.
- `session-lifecycle` — ADDED: terminal-first project use without chat
  session creation; empty-chat hygiene. (Depends on `planning-system-qol`
  which introduces this capability.)

(Terminal output/input/resize, stale-tab disconnected state, and manual
sync availability are implementation work under existing canonical
requirements in `omp-tab-integration`, `desktop-runtime-processes`,
`ide-workspace-state`, and `omp-account-usage-sync`.)

## Impact

- Rust: `terminal_service` (output event emit/attach, resize), tab restore
  path, `sync_service` (gate split manual vs auto, feedback events),
  `settings_service`/`models/permission.rs` (defaults),
  `omp_telemetry_service` (parser), `commands/skills.rs` (bundle path),
  `tauri.conf.json` (resources bundling), session/chat creation paths.
- TS: `TerminalPanel`/xterm wiring, `OmpTerminalTab`, `SettingsModal`
  (sync status line, updater panel), `FirstRunModal` (consent copy),
  `AppShell` (lazy chat session creation).
- Docs: AGENTS.md privacy line, `docs/agents/agent-runtime.md`,
  `docs/agents/desktop-shell.md`.
- Website (`basebuild-dotnet`): no API changes required — `POST /api/mcp`
  `sync_raw_usage` + cron `process-raw-usage` already exist and match the
  app's transport.
