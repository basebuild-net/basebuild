# Proposal: project-grid-workspace

## Why

Today the center workspace shows one tab type at a time (terminal, chat, file,
schematic) behind a flat tab bar, and only chat tabs get a multi-column grid.
The user can't mix a terminal and a chat side-by-side, can't drag a chat tab
onto a terminal to split it, and can't see what each panel is doing at a glance.
The left sidebar lists chat sessions, not live panel activity.

This change flattens tabs + the chat grid into a single **panel grid** per
project: any panel type (chat, terminal, file, schematic) lives in the grid,
drag-to-split creates VS Code-style horizontal/vertical splits, closing a panel
moves it to a history drawer (re-openable, not deleted), and the left sidebar
shows live per-panel status (title, type icon, progress, streaming indicator)
instead of chat-session rows. Clicking a project restores its full grid layout.

## What Changes

- **Unified panel grid** replaces the tab bar + chat-only grid. Any panel type
  (chat, terminal, file, schematic) is a grid leaf. No more separate "tab
  kinds" with special rendering paths — every tab is a panel in the grid.
- **VS Code-style drag-to-split**: dragging a panel's header onto another
  panel's left/right/top/bottom edge creates a new split. Visual drop zones
  show where the split will land before the drop is committed.
- **Panel close → history drawer**: closing a panel removes it from the grid
  but retains its session/state. A "History" button in the panel header or
  sidebar re-opens it into the grid. Chat sessions are never deleted on close.
- **Left sidebar → activity list**: instead of listing chat sessions, the
  sidebar shows live panels in the current project's grid — each row shows
  the panel title, type icon, a progress/streaming indicator (color + pulse
  animation for active chats, spinner for running terminals), and click to
  focus that panel in the grid. Modeled on t3code's activity sidebar.
- **Per-project grid persistence**: the full panel grid layout (panel ids,
  split tree, sizes, types) is saved per project and restored on project open.
  No silent side effects — terminals show disconnected state, chats don't
  auto-send.
- **Chat message chronology**: the conversation view reorders
  thinking/reasoning, messages, and tool calls into a strict chronological
  stream instead of grouping tool events separately from message bubbles.

**BREAKING (UI)**: removes the WorkspaceTabs tab bar, the chat-only ChatGrid,
the chat-session sidebar list, and the "Add chat beside" header menu action.
Replaces them with the panel grid + activity sidebar. Chat sessions remain
in the DB but are surfaced through the history drawer + activity sidebar, not
a session list.

## Capabilities

### New Capabilities

- `panel-grid` — unified panel grid that holds any panel type (chat, terminal,
  file, schematic) as leaves in a split tree; renders visible panels, handles
  resize via splitters, and supports an empty state.
- `panel-drag-split` — drag a panel's header onto another panel's edge to
  create a VS Code-style split (left/right/top/bottom); visual drop zones
  indicate where the split will land before the drop commits.
- `workspace-history` — closed panels move to a history drawer; re-open
  restores the panel into the grid with its session intact; chats are never
  deleted on close.
- `activity-sidebar` — left sidebar shows live per-panel status (title, type
  icon, progress/streaming indicator with color + animation) for the active
  project's grid; click to focus a panel.

### Modified Capabilities

- `desktop-shell` — the center workspace renders the panel grid instead of
  the tab bar + per-tab content; the left sidebar shows the activity list
  instead of chat sessions.
- `ide-workspace-state` — grid layout (split tree, panel ids, sizes, types)
  is persisted per project and restored on open; no silent side effects.
- `agent-chat` — chat message rendering becomes a strict chronological stream
  (thinking → message → tool-call → message) instead of grouped tool events.
- `chat-composer-controls` — composer rail renders inside a panel grid leaf
  instead of a chat-only grid column.

## Impact

- **Frontend**: `AppShell.tsx`, `WorkspaceTabs.tsx` (removed), `ChatGrid.tsx`
  (replaced by `PanelGrid.tsx`), `ProjectChatSidebar.tsx` (replaced by
  `ActivitySidebar.tsx`), `ChatPanel.tsx` (rendered as a panel leaf),
  `TerminalPanel.tsx` (rendered as a panel leaf), `FileViewer.tsx` (rendered
  as a panel leaf), `ProjectSchematicTab.tsx` (rendered as a panel leaf).
- **State**: `sessions.ts` — `tabGridStates` replaced by `panelGrids` per
  project; `SessionTab.kind` becomes `Panel.type`; grid math (`gridMath.ts`)
  gains a split-tree model alongside the existing flat-row model.
- **Backend**: no DB schema change required — panels map to existing
  session_tabs rows; the split tree is frontend state persisted via
  `save_workspace_restore_state`.
- **Reference**: [t3code](https://github.com/pingdotgg/t3code) (MIT) for the
  activity-sidebar + panel-grid visual model. We port the layout logic and
  visual structure, not files or dependencies.
- **Rollback**: the panel grid is behind the workspace renderer; reverting to
  the tab bar + ChatGrid restores prior behavior since session_tabs rows and
  chat sessions are unchanged.
