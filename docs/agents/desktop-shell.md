# Desktop Shell

Basebuild's app shell is a three-column grid:

1. **Left sidebar** (220px → 36px collapsed) — projects and sessions.
2. **Center workspace** — session header, workspace tabs, and the active tab
   view (terminal, file viewer, chat, or project schematic). The schematic
   tab renders structured section cards by default (Purpose, Vision, Blueprint,
   End goals, Current priorities, core rules) with per-section fill states and
   a health badge; a raw markdown toggle is available. The "Generate plans"
   modal was removed (schematic-grounded-planning) — generation runs through
   the chat planning menu.
3. **Right side panel** (260px → 36px collapsed) — stacked accordion sections
   for Plans, Files, and Source. The Plans section is a Planning Inspector
   with three tabs: Plans, Ideas, and Categories. The Plans tab exposes an
   **Import** action (`plan_import_detect` / `plan_import_apply`): it scans
   `openspec/changes/` for change folders not already linked to a `.basebuild`
   plan, lists them as candidates (title from `proposal.md`, status derived
   from `tasks.md` progress), and on explicit confirm writes
   `.basebuild/plans/<slug>/plan.md` records (`engine: openspec`, `external:`
   pointer, no duplicated task list). Detection never writes; re-import skips
   already-linked sources; malformed sources are reported and skipped.


The global taskbar sits above the shell. Its right side contains the update
indicator, account control, settings, and window controls. The update indicator
checks on startup and every 5 minutes; when an update is available it becomes a
blue one-click download/install button next to the account avatar. When the
update channel is broken (missing `latest.json`, malformed manifest, missing
Windows platform), the indicator shows "Update unavailable" in a warning state
instead of a red error — the user cannot fix this by retrying, and full
diagnostics are available in Settings → Updates.

## Tab kinds
- **Chat** — agent chat panel backed by a runtime profile. The default profile is `basebuild-native`, which runs structured chat, a compact one-line provider/model/effort control rail, slash-command accelerators (`/login`, `/model`, `/models refresh`), provider model sync, and local request metrics; OMP remains selectable.
Each workspace tab has a `kind`: `terminal`, `file`, `empty`, `chat`, or `omp`.

- **Terminal** — PTY-backed shell.
- **File** — file viewer for a specific path.
- **Empty** — renders the project schematic.
- **Chat** — agent chat panel backed by a runtime profile.
- **OMP** — raw OMP TUI terminal (`omp` in a PTY), shown only when OMP is
  detected installed. Displays a live telemetry HUD (provider, plan, model,
  effort, window utilization) alongside the terminal. Spawned only on explicit
  user action; restore never auto-spawns.

## Tab creation

The "+" menu in the workspace tab bar offers: Terminal, Schematic, Chat, and
(gated on OMP detection) Oh My Pi. Clicking a file in the Files panel opens a
file tab.

## Chat tab workflow routing

When a workflow (like Generate from context) requests a chat:

1. If the active tab is already a chat tab, use it.
2. Else if any chat tab exists, focus the most recent one.
3. Else create a new chat tab.

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

Basebuild does not create or focus a terminal process on launch, project
selection, or session restore. The workspace shows a neutral empty state
until the user explicitly creates a terminal, schematic, or chat tab via
the "+" menu. Terminal tabs restored from previous sessions that have no
live PTY show a "Terminal not connected" empty state instead of an
implied-running terminal.

## Workspace restore

Per-project workspace state (last session, last tab, side panel section,
sidebar/side collapse, side panel width) is persisted locally and restored on
project open. Side panel width is resizable via a drag handle between the center
workspace and the right panel, clamped to 180–520px. Restoring never auto-spawns
terminals or agents; stale process-backed tabs show a disconnected state until
the user explicitly reconnects.
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
