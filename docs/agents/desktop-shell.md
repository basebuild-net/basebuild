# Desktop Shell

Basebuild's app shell is a three-column grid:

1. **Left sidebar** (220px → 36px collapsed) — projects and sessions.
2. **Center workspace** — session header, workspace tabs, and the active tab
   view (terminal, file viewer, chat, or project schematic).
3. **Right side panel** (260px → 36px collapsed) — stacked accordion sections
   for Plans, Files, and Source.


The global taskbar sits above the shell. Its right side contains the update
indicator, account control, settings, and window controls. The update indicator
checks on startup and every 5 minutes; when an update is available it becomes a
blue one-click download/install button next to the account avatar. When the
update channel is broken (missing `latest.json`, malformed manifest, missing
Windows platform), the indicator shows "Update unavailable" in a warning state
instead of a red error — the user cannot fix this by retrying, and full
diagnostics are available in Settings → Updates.

## Tab kinds

Each workspace tab has a `kind`: `terminal`, `file`, `empty`, or `chat`.

- **Terminal** — PTY-backed shell.
- **File** — file viewer for a specific path.
- **Empty** — renders the project schematic.
- **Chat** — agent chat panel backed by a runtime profile.

## Tab creation

The "+" menu in the workspace tab bar offers: Terminal, Schematic, Chat.
Clicking a file in the Files panel opens a file tab.

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

## Plan pipeline

Plans move through: `draft → openspec → waiting → in_progress → finished`.
`cancelled` may terminate from any status. See `AGENTS.md` for plan field
details.
