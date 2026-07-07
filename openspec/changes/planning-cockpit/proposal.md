# Proposal: planning-cockpit

## Why

`planning-command-center` built the primitives — interactive `ask_user` cards,
planning events, notifications, flow board, integration queue, OMP RPC bridge —
but live use on 2026-07-07 shows the pipeline still is not *operable* end to
end. The seams between the pieces are broken or missing: schematic wizard
prompts are broadcast to the wrong chat, double-inserted, and auto-sent with
leftover composer text (`chatDraftTabId` is write-only dead state); both
plan→chat assignment entry points are stubs (the chat-header picker sets local
state only; the board's "Launch N ready" flips statuses behind a
`window.confirm` without starting anything); OMP-RPC-backed chats bypass the
agent loop entirely so agents still ask "reply with A/B" in prose; the app
cannot enumerate `openspec/changes/` or render a task checklist; completion is
silent; and the planning/source surfaces are ~300px side-rail components jammed
into a fixed 960×640 modal. Full evidence:
`docs/reports/2026-07-07-planning-cockpit-audit.md`.

This change makes the pipeline drivable from a visible cockpit: schematic and
planning turns land where the user *chooses*, plans launch into chosen
windows/tabs for real, OpenSpec changes are first-class (catalog, live
checklists, archive), completion asks and then commits or opens a PR — and
every decision point is a managed click UI, never prose or a native dialog.

## What Changes

- **Schematic → chat routing** — "Start wizard" / "Create schematic" opens a
  destination chooser (new conversation, or pick an open chat window/tab);
  the prompt is routed to exactly that chat session once, with explicit
  insert-vs-send semantics and no leftover composer text. Fixes the dead
  `chatDraftTabId`, the stale-`activeTabId` capture, and the
  consume-without-send race. The schematic panel entry point reliably opens
  the schematic surface in every project.
- **Real plan→chat assignment + destination-aware batch launch** — assignment
  binds the plan to the chosen chat session, seeds context, provisions the
  worktree per policy, and starts/queues the run (per `run-concurrency-limits`).
  Batch launch gets a destination summary (reuse chosen tabs / spawn new
  panels) and actually starts runs. Replaces both stubs; completes what
  `planning-command-center` tasks 6.4/6.5 intended (absorbed here if that
  change archives with them open).
- **Interactive coverage everywhere** — the OMP-RPC-backed native chat path
  gains `ask_user` interception (same question cards); prose questions
  ("reply with A/B…") get detected and rendered with quick-reply chips as a
  fallback; confirm-gated planning actions use managed in-app dialogs, never
  `window.confirm`.
- **OpenSpec change catalog** — enumerate `openspec/changes/` (artifact
  presence, task progress, linked plan, archive state); structured tasks.md
  parsing (phases + per-task ids); a checklist UI with click-to-toggle
  checkboxes; tasks.md change detection feeding planning events so progress is
  live; manual plan↔change linking; confirm-gated archive action. Planning
  piggybacks entirely on OpenSpec artifacts — no new plan format.
- **Planning command strip** — a persistent, compact status strip on the shell
  (counts by stage, status colors, activity pulse, unread planning badge) with
  click-through into the full board; flow-board stages become drillable as
  already specified.
- **Expanded planning/source layouts** — Plans & Ideas and Changes surfaces
  get wide-layout designs (multi-column master-detail) that fill their host;
  builds on `provider-parity-workspace-fixes` baseline `.modal` reflow without
  duplicating it.
- **Idea browser on the composer** — the Ideas button opens a picker of
  existing generated ideas (filter by status/category, promote, assign to a
  window/tab) with the generation actions kept as a secondary section.
- **Completion flow** — while running: per-plan progress indicators fed by the
  catalog's live task progress; when the checklist fills (or the run ends
  ambiguous): a "Mark as complete?" card; on completion: confirm-gated
  **Commit** / **Create pull request** actions and source-control context
  (branch, ahead/behind, changed files) on the card and on run rows.

## Capabilities

### New Capabilities

- `schematic-chat-routing` — destination chooser + targeted, single-shot
  prompt routing for schematic/planning turns; insert-vs-send contract.
- `openspec-change-catalog` — change enumeration, structured task checklists
  with manual toggle, live progress events, manual linking, archive action.
- `plan-completion-flow` — run progress indicators, mark-as-complete prompt,
  confirm-gated commit/PR with source-control context.

### Modified Capabilities

- `plan-chat-assignment` — assignment SHALL start/queue the run against the
  *chosen existing chat* (not only fresh spawns); batch launch gains a
  destination picker; removes the status-flip-only path.
- `chat-interactive-elements` — coverage guarantee for OMP-RPC-backed chats;
  prose-question quick-reply fallback; managed confirm dialogs for planning
  actions. (Base: `planning-command-center` delta — archive it first.)
- `planning-flow-board` — persistent command strip requirement; wide-layout
  board; stage drill-through reaffirmed as blocking. (Base:
  `planning-command-center` delta — archive it first.)
- `chat-idea-generation` — Ideas entry point becomes a browse/assign picker
  over the existing catalog with generation as secondary actions.

## Impact

- **Frontend**: `AppShell.tsx` (draft routing removal → destination chooser,
  command strip mount), `ChatPanel.tsx` (targeted prompt intake, prose
  quick-replies, completion card), `ChatComposerRail.tsx` + new
  `IdeaBrowser.tsx`, `PlanningInspector.tsx` / `PlanningFlowBoard.tsx`
  (drill-through, wide layout, real launch), new `CommandStrip.tsx`, new
  `ChangeCatalog.tsx` + `TaskChecklist.tsx`, new `DestinationPicker.tsx`,
  new managed `ConfirmDialog.tsx`; lib wrappers `openspecCatalog.ts`,
  extended `plans.ts` / `interactions.ts`; styles in `globals.css` only.
- **Backend (Rust)**: `openspec_service.rs` (list changes, structured task
  parse, toggle task, archive), new `commands/openspec.rs` surface;
  `plan_runner_service.rs` + new assignment command (bind run to existing
  `native_chat_sessions` row, worktree provisioning on dispatch);
  `native_chat_service.rs` (OMP-RPC `ask_user` interception); tool-event hook
  emitting task-progress planning events when `tasks.md` is written;
  `pull_request_service` / `final_touches_service` surfaced through completion
  commands. Additive SQLite only (no breaking migrations).
- **Specs/docs**: `docs/agents/openspec.md`, `docs/agents/desktop-shell.md`,
  `DESIGN.md` (command strip, wide layouts, dialog conventions).
- **Dependencies**: none added (tasks.md change detection uses tool-event
  hooks + scoped polling — no watcher crate).
- **Tests**: Rust unit (catalog enumeration, structured parse, toggle
  round-trip, assignment binding, RPC ask interception); Playwright e2e
  (destination chooser routing, real batch launch, checklist toggle, command
  strip counts, completion card commit/PR with mocked git, idea browser
  assign). Fix the `native_interaction_list_all` mock gap in
  `src/test-support/tauri-core.ts`.
- **Security / trust boundaries**: prose-question parsing renders escaped
  text only, chips send plain text replies — no HTML, no command execution;
  task toggle writes only inside `openspec/changes/**/tasks.md` under the
  project root (path-validated, no traversal); archive moves directories only
  within `openspec/`; commit/PR/merge remain confirm-gated with no silent
  side effects (Invariants 4/5 preserved); OMP RPC frames stay untrusted
  (tolerant parse, inert unknown kinds).
- **Coordination**: archive `planning-command-center` first (bases for two
  modified capabilities; its open tasks 6.4/6.5 are absorbed here).
  `provider-parity-workspace-fixes` owns baseline `.modal` reflow — this
  change layers wide layouts on top and must land after it or rebase its
  layout tasks. No overlap with `chat-history-persistence`.
