# Proposal: mvp-workflow-hardening

## Why

The planning pieces now exist, but the live MVP journey still breaks at its
seams. A 2026-07-08 desktop smoke found that the schematic wizard loses repo and
`ask_user` capability, category generation appears to do nothing, project
switches expose stale state, restart focuses the wrong project, and the
bottom-left account menu opens off-screen. The launch path also hides worker
and workspace policy in Settings and has no prerequisite/collision view, so a
user cannot safely drive several plan workers from idea to merge.

`mvp.md` records the product-level golden path and the observed baseline. This
change makes that path an executable contract: atomic project restore,
questionnaire-first schematic/ideation, explicit planning controls, real plan
dispatch, dependency-aware worker coordination, compact UI behavior, and an
end-to-end regression/performance harness.

## What Changes

- Persist and restore the last focused project, session, chat, and panel. A
  project switch enters a real loading boundary before clearing the old view;
  stale async responses cannot hydrate the new project.
- Make folder selection single-flight and add an immediate loading surface that
  keeps stale project content hidden while restore work completes.
- Replace fixed/off-screen menu math with viewport-clamped popovers and support
  the full shell/planning workflow at 960×640 and common Windows scale factors.
- Route schematic/category/idea actions through one destination-aware,
  tool-capable planning coordinator. Repository prefill and `ask_user` cards are
  mandatory; visible errors replace prose fallback or dropped prompts.
- Put planning engine, provider/model/effort, skill, worker count, and workspace
  policy in the promotion/launch flow, with saved project defaults.
- Add a plan dependency/collision graph from explicit prerequisites, priority,
  declared affected paths, and live file claims. Safe mode queues conflicting
  runs; explicit YOLO mode may override after a risk summary.
- Use the shared run board as the worker coordination ledger. It owns plan,
  branch/worktree, claims, progress, blockers, and merge readiness; chats show
  the same context in every header.
- Add desktop/e2e journey tests, compact visual snapshots, restart persistence,
  interaction latency markers, and a 60-second responsiveness smoke. Add CI
  guards for the mandatory UI invariants and remove current inline-style debt.

## Capabilities

### New Capabilities

- `plan-dependency-scheduling` — prerequisite/priority/path-collision analysis,
  safe scheduling, explicit YOLO override, live file claims, and a shared worker
  coordination/merge ledger.
- `mvp-journey-harness` — deterministic end-to-end golden-path, restart,
  responsive visual, interaction-latency, and freeze/noise regression coverage.

### Modified Capabilities

- `desktop-shell` — single-flight folder picker, atomic project loading surface,
  viewport-clamped menus, and compact shell behavior.
- `ide-workspace-state` — last focused project/session/chat/panel persistence and
  generation-guarded restore without cross-project state leakage.
- `schematic-chat-routing` — tool-capable questionnaire delivery and visible
  failures for schematic/category/idea actions. Requires `planning-cockpit` to
  archive so this delta has a canonical base.
- `planning-flow-board` — generation/launch control strip, consistent counts,
  worker policy, dependency state, and shared run-board drill-through.
- `plan-chat-assignment` — assignment carries the validated artifact bundle and
  selected model/skill/workspace policy into a real queued or running chat.
- `run-concurrency-limits` — launch-time worker count and workspace-policy
  controls expose the effective provider limit instead of hiding it in Settings.
- `parallel-workspaces` — every chat/run shows project, branch, worktree, claims,
  and merge readiness; sequential fallback remains explicit.
- `testing-automation` — UI-invariant checks and MVP journey/performance suites.

## Impact

- **Frontend:** `AppShell.tsx`, project/session hooks, `AccountButton.tsx`,
  `PlanningInspector.tsx`, destination/generation flows, flow/run board,
  chat-column headers, Settings, and `globals.css`.
- **Backend:** recent-project focus persistence, restore snapshots, planning
  dispatch options, dependency/collision service, run claims/events, and
  timing diagnostics. Commands remain thin validation/service/error adapters.
- **Data:** additive SQLite fields/tables for last project focus, plan
  prerequisites/priority/affected paths, run claims, and coordination events.
- **Tests/docs:** `mvp.md`, desktop-shell/agent-runtime/testing docs, DESIGN,
  Playwright/Tauri smoke fixtures, and CI invariant scripts.
- **Dependencies:** archive completed `planning-cockpit` and
  `panel-grid-state-reliability` first; finish or formally absorb
  `planning-command-center` tasks 6.4/6.5. Coordinate restore work with
  `chat-history-persistence`, provider errors with
  `provider-parity-workspace-fixes`, and subagent mechanics with
  `harness-subagents`.
- **Safety:** safe scheduling is default. YOLO mode never commits, merges,
  prunes, pushes, or opens a PR without the existing explicit confirmations.
  No new data-uploading network calls.
