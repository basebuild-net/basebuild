# Desktop Shell

Basebuild's app shell is a two-region, chat-first grid organized into four
ownership levels:

1. **Global navigation** — Projects, Chats, Settings, and Updates in the
   left sidebar. Plans/Ideas/Files/Source/Flow are not persistent left-nav
   items; they live in chat controls, context strip/header actions, or
   project modals.
2. **Project command strip** — stage-driven actions (Schematic, Ideas, Plans,
   Running, Done).
3. **Active chat** — transcript/activity timeline, composer, and per-chat
   context strip showing workspace id, branch, worktree, plan, progress,
   model, context-window usage, and run state.
4. **Project modals** — Schematic, Planning, Changes, Files, and Settings.

A control belongs to one level only. A stage button opens its exact destination;
it never creates a surrogate chat or defaults to a sibling tab.

The left sidebar (220px → 36px collapsed) shows projects and sessions. The center
workspace contains the command strip, chat context, workspace tabs, transcript,
and composer. Project-owned surfaces open as modals; there is no persistent right
side panel.

The **Planning** modal has six tabs: Plans, Ideas, Categories, Flow, Runs, and
Changes. The **Plans** tab exposes an **Import** action
(`plan_import_detect` / `plan_import_apply`): it scans `openspec/changes/`
for change folders not already linked to a `.basebuild` plan, lists them as
candidates (title from `proposal.md`, status derived from `tasks.md` progress),
and on explicit confirm writes `.basebuild/plans/<slug>/plan.md` records
(`engine: openspec`, `external:` pointer, no duplicated task list). Detection
never writes; re-import skips already-linked sources; malformed sources are
reported and skipped.

New planning work starts with a guided idea round. The user can select multiple
categories or a project-wide pass, request five to eight ideas (eight by
default), and route the prompt to an existing chat or a dedicated new chat.
Approving ideas creates one draft plan per idea. **Generate OpenSpec** performs
the local artifact-generation transition; **Approve plan** is a separate
validation decision before the plan becomes ready.

Planning catalogs use creation-recency order: newly added ideas, categories,
and plans appear first, with older records naturally moving toward the bottom.

The compact planning indicators above the chat are working quick menus, not
read-only counters. The Ideas lightbulb puts **Generate more ideas** first and
supports manual creation, status/category filtering, inline title/description/
category editing, status management, single or multi-idea upgrade to draft
plans, and confirmation-gated deletion. **Full UI** remains available for the
larger planning workspace without being required for these common actions.

The **Flow** tab is the compact coordinator: stage counts, planner/coding model
routing, worker count, safe dependency scheduling, workspace policy, queue
pause/start, completion review, merge review, and archive/sync navigation.
The **Runs** tab is mission control for owner chat, branch/worktree, task
progress, blockers, elapsed time, and supported run controls. The **Changes**
tab shows the OpenSpec change catalog and explicit archive action (see
`docs/agents/openspec.md`).

Account and update controls live at the bottom of the left sidebar. The update indicator
checks on startup and every 5 minutes; when an update is available it becomes a
blue one-click download/install button next to the account avatar. When the
update channel is broken (missing `latest.json`, malformed manifest, missing
Windows platform), the indicator shows "Update unavailable" in a warning state
instead of a red error — the user cannot fix this by retrying, and full
diagnostics are available in Settings → Updates.

## Tab kinds

A chat tab is no longer a single panel — it holds a **panel grid** (per
`chat-grid-layout`) rendered as a split tree. The split tree supports
horizontal (left/right) and vertical (top/bottom) splits to any depth,
producing `1×N` (single row, N panels) and `M×N` (M rows, N columns)
layouts. Each leaf is a fully independent panel with its own header,
composer rail (for chat panels), and content; panels can be split from
the header ("Split right/down"), reordered by header drag, resized via
splitters between siblings, and closed (animated collapse to history).
The split-tree layout (membership, order, split ratios) persists per
project across restarts via the workspace restore state's `panelGrid`
field. Closing a panel moves it to a `closedPanels` history list
(retaining its session); reopening restores it to the grid.

### Panel-grid state reliability

Panel-grid state is self-healing, project-scoped, and transactional:

- **Normalization on restore.** `parsePanelGridWithDiagnostics` recursively
  validates the split tree, panel shapes, and sizes. A stale `activePanelId`
  (pointing at a panel that no longer exists in the live tree) is repaired
  deterministically to a surviving live panel (or `null` when the tree is
  empty). Duplicate panel ids across the live tree and history are quarantined
  (the duplicate is dropped from history) with a diagnostic log; backing
  sessions/tabs are never deleted by normalization.
- **Checked insertion.** All panel creation flows through a single
  `insertPanel` helper that resolves the anchor, verifies exactly-once
  placement, and returns success or an actionable failure reason — never a
  silent no-op. Panel ids are collision-resistant (`crypto.randomUUID` via
  `newPanelId`).
- **Transactional resource-backed creation.** Chat/Terminal/OMP creation
  reserves a visible `creating` panel first, then acquires the backing tab or
  PTY, then binds the returned id atomically. On failure the reservation is
  rolled back (`removePanelFromGrid`) and the error is surfaced via the log
  panel; no orphan PTY or hidden tab remains. Rapid repeated clicks are
  serialized per type via an in-flight guard so one click produces exactly one
  panel and one backing resource.
- **Project-switch isolation.** A project-keyed loading boundary
  (`projectRestoreLoading` + a restore generation token) disables panel
  mutation until the selected project's restore resolves and guards late
  restore responses from a previous project. Debounced saves capture the
  project path and state in the timer closure so a save writes to the correct
  project even after the user has switched. Project selection/detection emits
  a single diagnostic event.
- **Orphan recovery.** `detectOrphanedTabs` flags backing session tabs that
  have no reachable panel in the live grid or history. Detection is
  non-destructive: it logs a single summary entry (count + kind breakdown),
  not one entry per tab, and dedupes by tab id so repeated state changes
  don't flood the log. Tabs whose kind matches a `creating` panel are
  excluded — the binding is in flight. Permanent cleanup is explicit and
  confirm-gated (HistoryDrawer's delete dialog); no session or tab is ever
  deleted automatically.
- **Debug logging.** Every panel creation, session start, project switch,
  restore, and prompt delivery emits a `addLog("debug", ...)` entry at the
  entry point and at every skip/abort branch. The `debug` level is visible
  in the LogPanel filter but excluded from the status bar error/warning
  counts. Chat session creation has a 15s timeout — on expiry the panel
  shows an error bar with a Retry button instead of hanging in
  "initializing" forever.

### Per-chat header

Each chat column renders a compact header (`chat-header-context`): the
chat title (inline-rename on double-click), provider/model chip, effort
chip, agent-mode pill (`plan`/`build`), plan badge (when a plan is
assigned), branch + worktree indicator, history toggle, and a more-actions
menu (Rename, Assign plan, Duplicate chat, Close chat, Close + delete
session, Create pull request). The header is pinned at the top of the
column and never scrolls out of view. Every control has a `title=` tooltip.

### Plan → chat → worktree → PR

A `ready` plan can be assigned to a chat column (one active per chat;
re-assign confirms + restarts). On run start, the system provisions a
worktree (`bb/<ref>-<slug>` from the fetched default branch), seeds the
chat from the plan + schematic, binds one model, and streams the run in
that column. Concurrent runs are bounded by per-provider concurrency
caps (`run-concurrency-limits`); excess runs queue with a visible reason.
## Panel creation

The Activity sidebar's "New chat" button creates a chat panel in the grid.
A "New terminal" button creates a terminal panel. Both split right from the
active panel (or fill the grid if empty). Panels can also be split from the
PanelHeader's "Split right" / "Split down" buttons. Clicking a file in the
Files panel opens a file panel in the grid.

## Chat panel workflow routing

When a workflow (like Generate from context) requests a chat:

1. If the active panel is already a chat panel, use it.
2. Else if the grid has any chat panel, focus the most recent one.
3. Else create a new chat panel (split right, or fill if grid is empty).

The draft prompt is delivered through a one-shot `draftPrompt` prop consumed
exactly once by ChatPanel. Do not overload `terminalId` or `filePath` for
this purpose.

## Shell state

Driven by `data-sidebar="collapsed|expanded"` and
`data-rail="collapsed|expanded"` attributes on `.app-shell`. CSS handles grid
width changes and hides panel labels in collapsed mode.

## Session state

`useSessionState` hook manages sessions, tabs, and active selection. Sessions
are project-scoped. Tabs are session-scoped. The last active session is
persisted per project. On restore, stale terminal tabs (whose PTY processes
are not alive after restart) are not auto-focused; the workspace prefers
non-terminal tabs or shows a neutral "No tab open" empty state.

### Launch does not mint sessions

App launch and project auto-restore reuse the project's most recent session.
A new session row is created only by an explicit user action (New Session). If
the project has zero sessions (first open), one is created. Focusing the app,
switching projects, or restarting never creates session rows.

### Session titles

New sessions start with a neutral placeholder title and are auto-titled from
the first meaningful activity (first user chat message, truncated to a short
phrase) unless the user has set a title manually. Inline rename sets
`title_locked` so auto-titling never overwrites a manual title.

### Stable sidebar ordering

The session list is ordered by `created_at DESC`. Selecting a session does not
bump its position — selection writes `last_selected_at` (not `updated_at`), so
clicking through sessions never reshuffles the list.

### Single instance guard

`tauri-plugin-single-instance` ensures only one process holds the database. A
second launch focuses the existing window and exits without starting a second
process against `state.db`.

## Startup behavior

Before the main shell renders, Basebuild shows a startup update splash
that checks for updates. The splash displays the current build version
and transitions through these states:

- **Checking** — update check in progress.
- **Optional update** — target version, summary, and `Upgrade` / `Skip
  update for now` buttons. Skip is version-scoped: the same target version
  is not prompted again, but a newer release will prompt.
- **Mandatory update** — when the running version is below the release
  channel's `minimumSupportedVersion`, the skip button is hidden and the
  update auto-starts.
- **Progress** — download progress bar and step text (downloading,
  installing, restarting).
- **Error** — actionable diagnostics with retry and "Continue anyway".

The splash does not replace the in-app update controls. The taskbar
update button and Settings → Updates tab remain functional after startup.

Recent-project metadata is cache-first in the webview: a validated local cache
can orient returning users on the first interactive render, then SQLite replaces
it with authoritative results. Session lists hydrate active-project-first and
yield between inactive projects so sidebar counts never block project restore.
The cache does not activate, inspect, modify, or upload projects.

SQLite records a code-owned `PRAGMA user_version`. Fresh or legacy databases
run the idempotent schema initializer and persist that version; current databases
skip the full table/column probe sequence on subsequent launches. Storage-heavy
project/session reads run through blocking-worker tasks rather than the Tauri
command thread.

Basebuild does not create or focus a terminal process on launch, project
selection, or session restore. The workspace shows a neutral empty state
until the user explicitly creates a terminal or chat panel. Terminal
panels restored from previous sessions that have no live PTY show a
"Terminal not connected" empty state instead of an implied-running
terminal.

## Activity sidebar

The left sidebar shows the list of open panels in the grid (the "activity
list"). Each row shows the panel type icon, title, and a status indicator
(streaming, idle, error). Clicking a row focuses the corresponding panel
in the grid. The sidebar also has a "New chat" button, a "New terminal"
button, and a History button with a count badge showing the number of
closed panels retained in history.

### Panel history

Closing a panel moves it to a `closedPanels` history list. The history
drawer (opened from the History button) lists closed panels with their
title, type, and close time. Each item has a "Re-open" action (restores the
panel to the grid) and a "Delete permanently" action (confirm-gated;
deletes the session for chat panels). The history list is per-project.

## Workspace restore

Per-project workspace state (last session, panel grid layout, closed panels,
sidebar collapse, side panel width) is persisted locally and restored on
project open. The panel grid state (`PanelGridState`) includes the split
tree, active panel id, and closed panels. Side panel width is resizable via
a drag handle between the center workspace and the right panel, clamped to
180–520px. Restoring never auto-spawns terminals or agents; stale
process-backed tabs show a disconnected state until the user explicitly
reconnects.
## Plan pipeline

Plans move through: `draft → openspec → ready → running → finished`.
`cancelled` may terminate from any status. Ideas generated in chat can be
promoted into the plan pipeline (tagged `chat:<id>`) or rejected. See
`AGENTS.md` for plan field details.

## Plan run queue

The PlanPanel includes a run queue section at the bottom. Ready plans can be
enqueued, and the queue dispatches runs up to the configured concurrency
(`N × provider/model`). The dispatcher is backend-owned (`plan_runner_service.rs`)
and survives panel unmounts. Each native run provisions a fresh chat session
titled `<ref> — <plan title>`, primed with the plan's opening context.
Completion is detected by `tasks.md` checkbox polling or explicit user action.
The OMP runner path opens a terminal tab seeded with the plan's reference id.

## Final touches

Per-project post-completion steps (shell, validate, commit, pull_request) are
configured in Settings → Final Touches. They execute sequentially after a run
completes; `finished` is gated on pipeline success. Remote-writing kinds
(commit, pull_request) default disabled.

## Parallel workspaces

When the project is a git repository, parallel plan runs can each execute in
an isolated git worktree (branch `bb/<ref>-<slug>`). Non-git projects fall back
to sequential execution (concurrency capped at 1).

## Flow board

The Planning Inspector's **Flow** tab renders a kanban-style board with
stages: Draft → OpenSpec → Ready → Running → Finished. Each stage shows
a count and the plans in that stage. Batch operations (promote, cancel)
are available via the inspector's batch bar.

## Integration queue

The Flow board's **Finished** stage renders an `IntegrationQueue` component
listing finished worktree runs with branch, ahead/behind, merged state, and
PR state. Each entry has a confirm-gated cleanup action: merged branches
offer safe worktree+branch removal; unmerged branches require force
confirmation. PR state is shown with a link to the PR URL when available.

## Command strip

The `CommandStrip` sits in the session header, showing per-stage counts
(schematic, ideas, plans, running, finished) with status colors and an
activity pulse on active runs. Schematic opens the dedicated Project Schematic
modal; Ideas and Plans open the Planning modal on their exact tabs; Running and
Finished open Flow. Stage clicks never default to a sibling tab.
The strip collapses to a compact badge; collapse state persists in workspace
restore.

## Modal ownership and loading states

Project-owned configuration and catalog surfaces live as modals, not workspace
panels. The five project modals are:

- **Schematic** — project-level schematic wizard progress and questions.
  No schematic workspace chat is created.
- **Planning** — plans, ideas, categories, flow, and changes tabs.
- **Changes** — OpenSpec change catalog (see `docs/agents/openspec.md`).
- **Files** — project file explorer.
- **Settings** — app and project configuration.

Each modal body uses visible skeleton, loading, error, and empty states. The
shared `ModalLoading` component provides the non-null fallback for Suspense
boundaries on user-opened surfaces; `null` fallbacks are not allowed.

Project switching immediately replaces project content with a stable loading
surface. A project-keyed loading boundary disables panel mutation until the
selected project's restore resolves and guards late restore responses from a
previous project. Errors include a retry control and are debug-logged with
action and project/session identifiers.

## Destination picker

The `DestinationPicker` is a managed dialog for choosing where a prompt goes.
It lists open chat panels and a "New conversation" option. The schematic
wizard uses it to route its generated prompt. The chosen destination receives
the prompt via `deliverPrompt()` — a module-level store outside React state
that guarantees exactly-once delivery by `actionId`.

## Completion card

When a run ends, the backend evaluates the linked change's `tasks.md`:
- **All tasks complete** → run auto-completes, plan transitions to `finished`.
- **Incomplete tasks** → run parks in `awaiting_review`, plan stays `running`,
  a planning event prompts the user to review.

The `CompletionCard` renders in the Flow board's Finished stage for
`awaiting_review` and `succeeded` runs. It shows:
- **Mark complete** button (for `awaiting_review` runs) — calls
  `plan_run_mark_complete`.
- **Commit** section — editable commit message, calls the existing git commit
  path.
- **Pull request** section — title + body, calls the existing `pr_create`
  path (including no-`gh` browser fallback).
- **Dismiss** button — hides the card for this run.

All confirm-gated actions use `ConfirmDialog`, never `window.confirm`.
