# Planning & Schematic System Audit — 2026-07-07

Current-state report for the planning/schematic pipeline, written against the
live codebase (branch state as of this morning) plus a UI walkthrough of the
E2E-mocked build (1720×990 viewport). Feeds the `planning-cockpit` OpenSpec
change. Everything below carries file:line evidence — nothing is speculative.

## 1. What the owner wants (target picture)

One operable pipeline, driven from a visible command center:

1. **Create a project schematic** (or auto-create), with the wizard turn landing
   in a chat the user *chose* — new conversation or an existing window/tab —
   never silently duplicated or auto-sent into the wrong place.
2. **Generate plans/ideas** grounded in the schematic; browse existing
   generated ideas from the composer's Ideas button and **assign them** to a
   window/tab instead of only triggering fresh generation.
3. **Assign many plans to many windows/tabs** — batch launch with a destination
   picker, then watch runs stream in parallel.
4. **See status at a glance** — a compact command strip at the top ("Plans &
   Ideas") with counts, colors, progress, and activity pulses; drill into a
   full board that expands to the window instead of a 960×640 fixed modal.
5. **Piggyback all planning on OpenSpec** — the app enumerates
   `openspec/changes/`, shows artifact presence and per-task checklists
   (tasks.md checkboxes) live, and lets the user tick tasks off manually. No
   bespoke skill/plan format beyond what exists.
6. **Close the loop on completion** — loading indicators while running,
   "Mark as complete?" when the checklist fills, then confirm-gated
   **Commit** / **Create PR** actions with source-control context (branch,
   ahead/behind, changed files) right on the card.
7. **Agent questions are a managed UI** — clickable options, multi-select, own
   free-text option, multiple questions per card. Never "reply with A/B" prose.

## 2. What already exists (and works)

The foundation is genuinely strong — most primitives are built:

- **Plan pipeline + statuses** — `draft → openspec → ready → running →
  finished` (+`cancelled`), legacy aliases accepted
  (`src-tauri/src/models/plan.rs:5-39`). Ideas: `concept → picked → rejected →
  archived`. Batch idea promotion exists (`plan_service.rs::batch_promote_ideas`).
- **OpenSpec generation** — `draft → openspec` runs a pipeline stage that
  writes `proposal.md`, `specs/*/spec.md`, `design.md`, `tasks.md` atomically
  and links `plans.change_name` (`openspec_service.rs:77-142`,
  `commands/plans.rs:104-127`).
- **Checkbox completion detection** — `plan_runner_service.rs:466-490` parses
  the linked `tasks.md` and auto-completes the run when `completed == total`.
- **ask_user interactive cards** — full lifecycle (tool → persisted
  `pending_interactions` → `QuestionCard` in transcript → resume loop) for
  native agent-loop chats and pipeline turns (`agent_loop_service.rs:680-762`,
  `ChatPanel.tsx:1354-1358`). Options, multi-select, confirm, text kinds all
  render; composer routes typed answers (`ChatPanel.tsx:753-777`).
- **Planning event bus + notifications** — typed `planning://event` with seq
  ordering (`models/planning_event.rs`), toasts + notification center.
- **Flow board** — five stages with live counts inside the Plans & Ideas modal
  (Flow tab), verified rendering in the walkthrough.
- **Source control + integration** — full git service, worktrees, PR
  recommendation card, `integration_service` (merge/cleanup/gh PR state),
  final-touches steps incl. commit + PR (default-disabled)
  (`final_touches_service.rs:27-60`).
- **OMP RPC bridge** — persistent RPC session maps OMP `user_input` frames to
  the same `pending_interactions` cards (`omp_rpc_session_service.rs:317-397`).

## 3. Current limitations (root causes, with evidence)

### 3.1 Schematic-to-chat insertion is broken at the seam
`handleStartSchematicWizard` (`AppShell.tsx:427-467`) focuses/creates a chat
tab, then sets three pieces of shell state: `chatDraft`, `chatDraftTabId`,
`autoSendDraft`.

- `chatDraftTabId` is **write-only** — set at `AppShell.tsx:463`, cleared at
  `:626`, **never read**. The draft is therefore broadcast: `draftPrompt` is
  passed to every mounted `ChatPanel` (`AppShell.tsx:624`), so whichever panels
  are mounted all react.
- `session.activeTabId` is captured **stale** right after the async
  `createTab` (`AppShell.tsx:463`), so the intended target is wrong whenever a
  tab was just created — clicking from the Schematic tab targets the Schematic
  tab.
- The consuming effect (`ChatPanel.tsx:710-727`) does `setInput(draftPrompt)`
  **then** conditionally auto-sends. If `catalog`/`loading` gates fail, it
  consumes the draft without sending → *"clicking does nothing"*. On a later
  click the gate passes → it **sends** and the composer **still contains the
  inserted text** (nothing clears `input` after `sendMessage`) → *"sends it
  and also has it in the chat input"*. Exactly the reported symptoms.
- Clicking "Project schematic" in the panel list calls `handleOpenSchematic`
  (`AppShell.tsx:469-477`) which focuses/creates a legacy `empty`-kind tab —
  in the chat-first shell there is no visible affordance for that tab kind in
  some project states, so the click *appears* to do nothing.

**Verdict: broken.** There is no destination chooser, no single-insert
semantics, and no backend API to append a message to an existing chat
(`native_chat_service` has only internal seeding; no command).

### 3.2 Plan→chat assignment is stubbed in both directions
- Chat header **"Assign plan"** picker lists ready plans, but
  `handleAssignPlan` (`ChatPanel.tsx:1139-1145`) only sets local component
  state. No enqueue, no seeding, no worktree, no run. The canonical
  `plan-chat-assignment` spec (assignment provisions worktree + starts run) is
  not satisfied.
- Flow board **"Launch N ready"** (`PlanningInspector.tsx:487-499`) flips each
  plan's status to `running` behind a `window.confirm` — no chat spawn, no
  run row, no worktree, despite the tooltip claiming otherwise. Plans strand
  in `running` with nothing running. (This is unfinished task 6.4 of
  `planning-command-center` surfaced as a misleading control.)
- Backend run dispatch always creates a **new** `native_chat_sessions` row
  (`plan_runner_service.rs:691-719`); there is no command to bind a plan/run
  to an existing chat session, and `plan_runs.workspace_path` is never set by
  dispatch (worktrees require a separate explicit `workspace_create`).

### 3.3 "Reply with A/B" prose still happens — two uncovered runtimes
- **OMP-RPC-backed native chat**: `native_chat_service.rs:679-696` forces
  `supports_tools = false` when the provider routes through OMP RPC, so the
  agent loop (and with it `ask_user`) is bypassed — the model can only ask in
  prose. This is the primary source of "reply with A/B" text.
- **Raw OMP terminal tabs**: a pty stream; no structured question channel at
  all.
- Additionally, nothing detects prose questions and offers clickable
  quick-replies, so any model that just *doesn't call* `ask_user` degrades to
  typing.
- Assorted flows still use `window.confirm` (e.g. launch confirmation), not a
  managed in-app dialog.

### 3.4 No OpenSpec catalog — the app can't see its own plans' artifacts
- No command enumerates `openspec/changes/` (only collision-checking on
  create). Artifact presence, task progress, and archive state are invisible
  unless a plan happens to link a change.
- Task progress is a flat `completed/total` count (`openspec_service.rs:144-159`)
  — no per-task ids, no phase structure, no way to render or toggle a
  checklist item from the UI (the model edits `tasks.md`; the user can't).
- Progress is **poll-only** (on run status checks); the `openspec-artifacts`
  spec requires refresh on file change, but no watcher or tool-event hook
  exists — external edits to `tasks.md` go unnoticed.
- No archive action, no manual plan↔change linking command (service fn exists,
  unexposed).

### 3.5 Command center visibility
- The five-stage flow board exists but only inside the modal's Flow tab.
  Nothing at the shell level shows counts/status/activity; the "Plans &
  Ideas" sidebar/environment buttons are plain buttons with no badges.
- Stage cards are **not drillable** — clicking "Schematic"/"Plans" does
  nothing (verified in walkthrough), violating the in-flight
  `planning-flow-board` spec ("stages SHALL be drillable").

### 3.6 Modal surfaces don't scale
- Both Plans & Ideas and Changes render side-rail components
  (`PlanningInspector`, `SourcePanel`, ~300px design) inside a fixed
  `.modal` — measured **960×640 in a 1720×990 viewport** in the walkthrough.
  Content jams into a narrow column at any window size.
- The not-started `provider-parity-workspace-fixes` change already specs the
  *baseline* adaptive `.modal` sizing + reflow; what it does not cover is a
  *wide-layout redesign* (multi-column board, master-detail) once space is
  available.

### 3.7 Ideas button is generation-only
`ChatComposerRail`'s Ideas button opens a menu of **actions** (Quick ideas /
By category… / Planning inspector, `ChatPanel.tsx:1613-1674`) — it cannot
browse existing generated ideas, filter by status/category, or assign an idea
to a window/tab.

### 3.8 Completion loop has no face
Auto-complete fires silently when checkboxes fill (3.2's detection works);
final-touches commit/PR exist but are config-buried and default-disabled; the
PR recommendation card only appears in the run's chat. There is no
"Mark as complete?" moment, no completion card with commit/PR actions, and no
source-control context (branch, ahead/behind, changed files) on plan/run rows
outside that chat.

## 4. Delta to build (summary)

| # | Gap | Fix shape |
|---|-----|-----------|
| 1 | Schematic insertion broken | Destination chooser (new chat / pick window+tab / cancel), targeted draft routing keyed by chat session id, single-insert + explicit send semantics |
| 2 | Assignment stubs | Real assignment path: bind plan → chosen chat session, enqueue run, seed context, worktree per policy; batch launch with destination summary |
| 3 | ask_user coverage | Route `ask_user` through OMP RPC chat path; prose-question quick-reply chips as fallback; managed in-app confirms |
| 4 | No OpenSpec catalog | `openspec_list_changes` + structured tasks parse (ids/phases), checklist UI with click-to-toggle, tasks.md change detection → planning events, archive + manual link |
| 5 | No command center | Persistent command strip (counts, colors, pulse, unread) + drillable stages |
| 6 | Cramped modals | Wide-layout redesign on top of `provider-parity-workspace-fixes` baseline reflow |
| 7 | Ideas button | Idea browser/picker (browse, filter, promote, assign-to-tab) with generation actions kept |
| 8 | Silent completion | Completion card: "Mark as complete?", confirm-gated Commit / Create PR, source-control context chips |

All eight are covered by the new **`planning-cockpit`** OpenSpec change
(`openspec/changes/planning-cockpit/`). Items 2/5 partially overlap
`planning-command-center` tasks 6.4/6.5 (batch launch + e2e) — that change
stays the owner of its two open tasks only if it lands first; otherwise
`planning-cockpit` absorbs them (noted in its proposal).

## 5. Coordination notes

- `planning-command-center` (46/48, in flight) — this audit's change builds on
  its specs (`chat-interactive-elements`, `planning-flow-board`); archive it
  first so deltas apply to canonical bases.
- `provider-parity-workspace-fixes` (0/42) — owns baseline modal reflow +
  unborn-HEAD git fix; `planning-cockpit` depends on its `.modal` sizing work
  for the wide layouts and must not duplicate it.
- `chat-history-persistence` (0/21) — fixes the `save_workspace_restore_state`
  / `sideCollapsed` restore bug; unrelated seam, no overlap.
- E2E mock gap observed live: `native_interaction_list_all` is unhandled by
  the mock layer and renders an error banner in every mocked chat
  (`src/test-support/tauri-core.ts`) — worth fixing alongside e2e work.
