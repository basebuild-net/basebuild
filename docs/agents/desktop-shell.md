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
it never creates a surrogate chat or defaults to a sibling surface.

The left sidebar (220px → 36px collapsed) shows projects and their active
surfaces. The center workspace contains the command strip, pinned chat
header, split-tree surfaces, transcript, and composer. Project-owned
surfaces open as modals; there is no persistent right side panel.

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

Before launch, idea and plan detail can show a local execution assessment:
estimated time, difficulty, uncertainty, risk, parallelism, and an explainable
planner/coder route recommendation. Stale, offline, or missing provider
evidence is labeled and reduces confidence. Apply is explicit and opens the
normal route controls; recommendations never start work or override a user's
persisted model choice silently.

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

Background agents and Runs share backend truth from pipeline, run, owner-chat,
pending-interaction, and pending-approval snapshots. `active`, `queued`,
`needs input`, `awaiting review`, `interrupted`, `failed`, and `complete` are
separate states. Closing a surface does not stop its retained chat. Clicking the
run body reopens that owner chat; Stop/Cancel remains a separate action. Ready
plans with an awaiting-review or continuation run do not inflate Running counts.
Available next actions are state-specific (`Resume`, `Review`, `Retry`,
`Archive`) and disabled actions state the backend reason.

Account and update controls live at the bottom of the left sidebar. The update indicator
checks on startup and every 5 minutes; when an update is available it becomes a
blue one-click download/install button next to the account avatar. When the
update channel is broken (missing `latest.json`, malformed manifest, missing
Windows platform), the indicator shows "Update unavailable" in a warning state
instead of a red error — the user cannot fix this by retrying, and full
diagnostics are available in Settings → Updates.

## Surface model

The workspace is a split tree of independent surfaces, not tab groups. Each
leaf owns exactly one surface — a Basebuild Chat, Oh My Pi Chat, or
Terminal. There are no tab arrays inside leaves.

```text
activeSurfaces: Record<surfaceId, SurfaceRecord>
visibleTree: SplitNode | LeafNode(surfaceId) | null
history: ClosedSurfaceRecord[]
focusedSurfaceId: surfaceId | null
```

**Active registry** (`activeSurfaces`) holds every active surface — visible
or hidden — keyed by `surfaceId`. Each `SurfaceRecord` owns kind (Chat, Oh
My Pi Chat, or Terminal), backing resource id, title, and lifecycle/status.
A surface's identity and draft do not depend on where it is displayed.

**Visible tree** (`visibleTree`) is a split tree whose leaves contain only
`surfaceId`. Split nodes own direction, ratio, and focus. The tree
supports horizontal (left/right) and vertical (top/bottom) splits to any
depth. One surface is `focusedSurfaceId` at a time; the focused leaf
receives an active outline.

**History** (`history`) is a third retained collection of closed surfaces.
Reopening from History returns a surface as active hidden, preserving the
current layout.

### Selection, placement, and lifecycle

- **Selecting a visible row** focuses its existing leaf in the split tree.
- **Selecting a hidden active surface** replaces the focused leaf; the
  displaced surface remains active hidden.
- **Open beside / Open below** explicitly splits the focused leaf when
  capacity permits.
- **Remove from layout** hides a surface without closing it; it remains
  active in the registry and visible in the sidebar without the visible
  marker.
- **Drag a surface header** onto another visible surface to move it into that
  linked layout; the target edge chooses left/right/top/bottom placement.
  Dropping on the sidebar unlink target removes it from the layout without
  closing it.
- **Drag an unlinked sidebar row** onto a visible row to link it into the
  current layout. Dragging a visible row onto the unlinked section hides it.
- **Close** moves the surface to retained History. The backing session or
  PTY is never deleted by closing.
- **Reopen** from History returns the surface as active hidden, preserving
  the current layout.

### Capacity policy

Initial minimums are 440px width for Chat and Oh My Pi Chat leaves, and
320px width for Terminal leaves, plus practical minimum heights derived
from header/composer/state geometry. A split computes both children's
minimum requirements before mutation; splitter ratios clamp against pixel
minimums. On window shrink, deterministically hide
least-recently-focused nonfocused leaves until all visible leaves fit;
they remain active hidden. New placement that cannot fit is rejected with
`Replace focused` as the primary alternative.

### Oh My Pi Chat surface

Oh My Pi Chat is an install-gated optional surface that wraps one OMP PTY.
It is additive — never required for native Chat or planning.

- Labeled `Oh My Pi Chat` with secondary `OMP terminal session` ownership
  copy.
- One PTY per surface. States: creating, running, disconnected, exited,
  error, restart.
- xterm shell colors derive from computed CSS tokens, not hardcoded
  values. Fitting uses a requestAnimationFrame-batched `ResizeObserver`
  on the container, not window resize.
- Bounded scrollback; the unbounded React-line rendering path is removed.

### Surface state reliability

Surface state is self-healing, project-scoped, and transactional:

- **Normalization on restore.** The restore parser recursively validates the
  split tree, surface shapes, and sizes. A stale `focusedSurfaceId`
  (pointing at a surface that no longer exists in the live tree) is
  repaired deterministically to a surviving live surface (or `null` when
  the tree is empty). Duplicate surface ids across the live tree and
  history are quarantined (the duplicate is dropped from history) with a
  diagnostic log; backing sessions/PTYs are never deleted by
  normalization.
- **Checked insertion.** All surface creation flows through a single
  insertion helper that resolves the anchor, verifies exactly-once
  placement, and returns success or an actionable failure reason — never
  a silent no-op. Surface ids are collision-resistant (`crypto.randomUUID`).
- **Transactional resource-backed creation.** Chat/Terminal/OMP creation
  reserves a visible `creating` surface first, then acquires the backing
  session or PTY, then binds the returned id atomically. On failure the
  reservation is rolled back and the error is surfaced via the log panel;
  no orphan PTY or hidden session remains. Rapid repeated clicks are
  serialized per type via an in-flight guard so one click produces exactly
  one surface and one backing resource.
- **Versioned migration.** Workspace persistence is versioned. For each
  legacy leaf with tab groups, the active tab migrates into the
  corresponding leaf and every other valid tab inserts into
  `activeSurfaces` as hidden. Visible ids are deduplicated
  deterministically; invalid entries are quarantined with one summary
  diagnostic. Backing sessions and PTYs are never deleted during
  normalization. The migrated form is persisted after successful restore.
- **Project-switch isolation.** A project-keyed loading boundary
  (`projectRestoreLoading` + a restore generation token) disables surface
  mutation until the selected project's restore resolves and guards late
  restore responses from a previous project. Debounced saves capture the
  project path and state in the timer closure so a save writes to the
  correct project even after the user has switched. Project
  selection/detection emits a single diagnostic event.
- **Orphan recovery.** Detection flags backing sessions that have no
  reachable surface in the live tree or history. Detection is
  non-destructive: it logs a single summary entry (count + kind
  breakdown), not one entry per session, and dedupes by id so repeated
  state changes don't flood the log. Sessions whose kind matches a
  `creating` surface are excluded — the binding is in flight. Permanent
  cleanup is explicit and confirm-gated (HistoryDrawer's delete dialog);
  no session or PTY is ever deleted automatically.
- **Debug logging.** Every surface creation, session start, project
  switch, restore, and prompt delivery emits a `addLog("debug", ...)`
  entry at the entry point and at every skip/abort branch. The `debug`
  level is visible in the LogPanel filter but excluded from the status bar
  error/warning counts. Chat session creation has a 15s timeout — on
  expiry the surface shows an error bar with a Retry button instead of
  hanging in "initializing" forever.

### Pinned chat header

Each chat surface renders a pinned 28–32px header: the chat title
(inline-rename on double-click), provider/model chip, effort dropdown,
agent-mode pill (`plan`/`build`), plan badge (when a plan is assigned),
context usage circle, run state, and a more-actions menu (Rename, Assign
plan, Duplicate chat, Close chat, Close + delete session, Create pull
request). The header is pinned at the top of the chat surface and never
scrolls out of view. Configuration is not duplicated in the composer.
Every control has a `title=` tooltip.

### Plan → chat → worktree → PR

A `ready` plan can be assigned to a chat surface (one active per chat;
re-assign confirms + restarts). On run start, the system provisions a
worktree (`bb/<ref>-<slug>` from the fetched default branch), seeds the
chat from the plan + schematic, binds one model, and streams the run in
that surface. Concurrent runs are bounded by per-provider concurrency
caps (`run-concurrency-limits`); excess runs queue with a visible reason.
## Surface creation

One shared typed menu offers Basebuild Chat, Oh My Pi Chat (when OMP is
installed), and Terminal. All plus/New actions — sidebar, header, and
command strip — invoke the same component and transaction. Default
creation replaces/fills the focused leaf when no capacity is available;
explicit `Open beside` / `Open below` placement is offered when capacity
permits. Reservation, backing-resource acquisition, binding, failure
rollback, logging, and in-flight deduplication remain centralized.

## Chat surface workflow routing

When a workflow (like Generate from context) requests a chat:

1. If the focused surface is already a chat surface, use it.
2. Else if the visible tree has any chat surface, focus the most recent
   one.
3. Else create a new chat surface (replace focused, or fill if tree is
   empty).

The draft prompt is delivered through a one-shot `draftPrompt` prop
consumed exactly once by ChatPanel. Do not overload `terminalId` or
`filePath` for this purpose.

## Shell state

Driven by `data-sidebar="collapsed|expanded"` and
`data-rail="collapsed|expanded"` attributes on `.app-shell`. CSS handles grid
width changes and hides surface labels in collapsed mode.

## Session state

`useSessionState` hook manages sessions and active selection. Sessions
are project-scoped. The last active session is persisted per project. On
restore, stale terminal surfaces (whose PTY processes are not alive
after restart) are not auto-focused; the workspace prefers non-terminal
surfaces or shows a neutral empty state.

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

A pre-React **boot layer** (`#bb-boot` in `index.html`) paints immediately —
before the JS bundle evaluates — using theme-matched colors from the same
pre-paint bootstrap that sets the theme attribute and UI scale. `App` tears it
down on mount (fade, then `remove()`), so cold start shows a branded frame
instead of a blank window while the module graph loads. Once hidden it is inert
(`pointer-events: none`) and never gates interaction.

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
until the user explicitly creates a terminal or chat surface. Terminal
surfaces restored from previous sessions that have no live PTY show a
"Terminal not connected" empty state instead of an implied-running
terminal.

## Activity sidebar

The left sidebar shows all active surfaces under each project, grouped by their
linked group and ordered by recency — the last time the user sent a message to a
chat, which lifts that chat's group or solo to the top with the group's members
kept contiguous in split-tree order. Focusing or clicking a chat never reorders
the list, and neither do assistant replies or background updates; only a user
send does. Each row's timestamp is the last user message. A row
carries a coloured square when its surface belongs to a linked group; each
group gets a distinct, stable colour so sibling groups never read as one; solo
chats have no square. Each row shows a title, timestamp, and one state word.
Every project's surfaces render this same way — with status, timestamp, and
grouping — so the full picture is visible without focusing a project; inactive
projects' rows select the project on click. Clicking a visible row focuses its
leaf. Clicking a surface in an inactive group restores that whole group and
focuses it; clicking a solo unlinked chat shows only it. The previously visible
layout is always parked intact, so switching chats never silently breaks a
group apart. Rows are draggable to regroup or unlink. `Add linked chat` sits
under the bottom-most chat of the visible group (adding a chat linked to it),
and a History button shows a count badge of closed surfaces. Close controls
reveal on `:focus-within`, not just `:hover`.

### Surface history

Closing a surface moves it to a per-project `history` collection. The
history drawer (opened from the History button) lists closed surfaces with
their title, type, and close time. Each item has a "Re-open" action
(returns the surface as active hidden, preserving the current layout) and
a "Delete permanently" action (confirm-gated; deletes the session for
chat surfaces). The history list is per-project.

## Workspace restore

Per-project workspace state (last session, active surface registry,
visible split tree, focused surface id, history, sidebar collapse) is
persisted locally and restored on project open. The workspace state
includes the split tree (whose leaves reference surface ids), the active
surface registry, and the history collection. Restoring never auto-spawns
terminals or agents; stale process-backed surfaces show a disconnected
state until the user explicitly reconnects.

Persistence is **debounced (~250ms) and deferred to `requestIdleCallback`**
(1s timeout fallback) in `AppShell`, so serializing and writing workspace
state never competes with interaction paint during rapid surface
switching. The debounce timer closure captures the project path so a
deferred write always lands on the correct project even after a switch.

## Plan pipeline

Plans move through: `draft → openspec → ready → running → finished`.
`cancelled` may terminate from any status. Ideas generated in chat can be
promoted into the plan pipeline (tagged `chat:<id>`) or rejected. See
`AGENTS.md` for plan field details.

## Plan run queue

The PlanPanel includes a run queue section at the bottom. Ready plans can be
enqueued, and the queue dispatches runs up to the configured concurrency
(`N × provider/model`). The dispatcher is backend-owned (`plan_runner_service.rs`)
and survives surface unmounts. Each native run provisions a fresh chat session
titled `<ref> — <plan title>`, primed with the plan's opening context.
Completion is detected by `tasks.md` checkbox polling or explicit user action.
The OMP runner path opens a terminal surface seeded with the plan's reference id.

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
Finished open Flow. Stage clicks never default to a sibling surface.
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
It lists open chat surfaces and a "New conversation" option. The schematic
wizard uses it to route its generated prompt. The chosen destination receives
the prompt via `deliverPrompt()` — a module-level store outside React state
that guarantees exactly-once delivery by `actionId`.

## Completion card

When a run ends or its owner chat becomes idle, the backend lifecycle authority
evaluates the linked change's `tasks.md`:
- **All tasks complete** → run succeeds and the plan transitions to `finished`.
- **Incomplete tasks** → run parks in `awaiting_review` with a
  `needs_continuation` outcome, the plan returns to `ready`, and a planning event
  prompts Review/Resume rather than claiming work is live.

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

Assignment, kickoff failure, stop, error, interaction/approval blocking, idle,
review, completion, cancellation, restart, and chat deletion all transition
through `PlanLifecycleService`. Startup and list/dispatch boundaries reconcile
contradictory persisted rows idempotently without deleting terminal history.
Deleting a run-owned chat is blocked until the user explicitly cancels, keeps,
or reassigns the run; ordinary surface close remains presentation-only.
