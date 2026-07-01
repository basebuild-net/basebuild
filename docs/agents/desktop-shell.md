# Desktop Shell

Basebuild's app shell is a three-column grid:

1. **Left sidebar** (220px → 36px collapsed) — projects and sessions.
2. **Center workspace** — session header, workspace tabs, and the active tab
   view (terminal, file viewer, chat, or project schematic).
3. **Right side panel** (260px → 36px collapsed) — stacked accordion sections
   for Plans, Files, and Source.

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
persisted per project.

## Plan pipeline

Plans move through: `draft → openspec → waiting → in_progress → finished`.
`cancelled` may terminate from any status. See `AGENTS.md` for plan field
details.
