# Tasks: OMP Terminal & Usage Sync Readiness

## 1. Terminal Output Plumbing (P0)

- [ ] 1.1 Trace the PTY output path in the packaged build: reader thread →
      Tauri event emit (name + window label) → webview listener → xterm
      write; identify where bytes stop (spawn side verified working:
      omp.exe/powershell.exe + conhost 80x24 children exist)
- [ ] 1.2 Fix output delivery so a new Terminal tab shows the shell prompt
      and echoes input in the packaged build
- [ ] 1.3 Fix input path if still broken after output fix (no echo observed)
- [ ] 1.4 Wire resize: xterm fit → `terminal_resize` on tab mount, panel
      resize, and window resize (PTY currently stuck at 80x24)
- [ ] 1.5 Audit the collapsed "+ Terminal #N" section: terminal must mount
      expanded with a non-zero viewport, or defer xterm attach until
      expanded (zero-height mount breaks fit)
- [ ] 1.6 Restored terminal tabs without live PTYs show the disconnected
      state with a Reconnect affordance (never an empty live-looking
      terminal); OMP restore never auto-spawns omp
- [ ] 1.7 Add a debug-panel PTY byte-trace toggle (per-terminal in/out
      counters) so future plumbing breaks are one-glance diagnosable

## 2. OMP Telemetry Parser

- [ ] 2.1 Parse omp 16.x `omp usage --json` (`reports[].limits[]`, window
      objects with reset timestamps) into `OmpUsageWindow` rows; keep
      legacy `windows`/`usage` array support
- [ ] 2.2 Verify `omp stats --json` message parsing against omp 16.x
      output; fix field drift (attachment state must reach "attached" on a
      machine with live OMP data)
- [ ] 2.3 Parse-mismatch state: valid-JSON-unknown-shape shows "telemetry
      format not recognized — omp <version>" in the HUD; raw error in logs
- [ ] 2.4 Rust unit tests with captured omp 16.3.6 fixture JSON (redacted)

## 3. Usage Sync Defaults & Feedback

- [ ] 3.1 Split gates: `manual_gates_pass()` (signed-in + upload
      permission) for "Sync now" (skip freshness check); periodic keeps
      the full gate set
- [ ] 3.2 Blocked/failed/succeeded outcomes: every trigger emits a status
      event naming the result or failed gate; SettingsModal renders it
      (blocked state links to the permission/setting to fix)
- [ ] 3.3 Flip defaults after sign-in: `auto_sync_usage`,
      `allowUsageAnalyticsUpload`, `allowUsageAnalyticsCollection` default
      on (missing-row semantics only; explicit user choices persist)
- [ ] 3.4 Sign-in surface + Account section copy disclose default-on sync
      and the aggregated-usage-only payload; opt-out is one click
- [ ] 3.5 Persist and display "Last sync" (survives restart, not just
      in-memory status); update after each push
- [ ] 3.6 Update AGENTS.md privacy line + `docs/agents/agent-runtime.md`
      for the new defaults (owner-approved change to the privacy contract)

## 4. Skills Distribution

- [ ] 4.1 Bundle `skills/` into the installer via Tauri resources config;
      verify `read_skill` resolves in the packaged layout
- [ ] 4.2 Add `list_skills` command (name + description per bundled skill)
      with a thin lib wrapper
- [ ] 4.3 Surface skill load failures in the log panel (path + skill name)
- [ ] 4.4 Wire `basebuild-session-title` availability check: if the
      packaged build lacks it, session auto-titling (planning-system-qol
      6.2) falls back to local truncation without erroring

## 5. Terminal-First Sessions

- [ ] 5.1 Project open / restore creates no chat tabs and no native chat
      rows; default workspace surface is the neutral schematic/empty state
- [ ] 5.2 First chat interaction lazily creates the chat tab's native
      session (bound to the project session)
- [ ] 5.3 Empty never-used chats: reuse on reopen; hide or collapse
      zero-message chats in sidebar lists behind a "show empty" affordance
- [ ] 5.4 One-time cleanup affordance for existing empty sessions/chats
      (explicit user action, with count preview — no silent deletion)

## 6. Updater Panel QoL

- [ ] 6.1 Settings → Updates shows real installed and latest versions
      (never "—" alongside "You're on the latest version")
- [ ] 6.2 Update prompts never offer a version older than the running
      build (observed: dev build offered 0.0.11 while 0.0.12 installed)

## 7. Verification

- [ ] 7.1 `npx tsc --noEmit`, `npm run build`; `cargo check` + `cargo test`
      in `src-tauri/` (tests under isolated BASEBUILD_HOME)
- [ ] 7.2 e2e: terminal echo assertion (scripted PTY), sync feedback states
      (blocked/success/failure), lazy chat creation
- [ ] 7.3 Packaged-build smoke on Windows: install → sign in → OMP tab runs
      TUI visibly → "Sync now" succeeds with visible timestamp → auto-sync
      pre-checked → skills readable; screenshot each step
- [ ] 7.4 Confirm `usage_sync_settings`/status reflect pushes and
      basebuild.net receives the blob (check via account usage page)

## 8. Docs & Roadmap

- [ ] 8.1 Update `docs/agents/desktop-shell.md` (terminal-first sessions,
      disconnected/reconnect states) and `docs/agents/agent-runtime.md`
      (sync gates, telemetry parser versioning, skills bundling)
- [ ] 8.2 Refresh roadmap: `node scripts/openspec-status.mjs --write` +
      ROADMAP narrative update in the same commit
