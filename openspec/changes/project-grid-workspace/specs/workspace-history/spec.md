## ADDED Requirements

### Requirement: Close to history
The system SHALL move a panel to a project-scoped history drawer when the user closes it, rather than deleting its session or state. The history drawer is accessible via a "History" button in the panel header's more-actions menu or the activity sidebar. Re-opening a panel from history restores it into the grid with its session intact.

#### Scenario: Close a chat panel
- **WHEN** the user closes a chat panel via the more-actions menu or the close button
- **THEN** the panel animates out of the grid, the chat session is retained in the DB, and the panel appears in the history drawer

#### Scenario: Re-open from history
- **WHEN** the user opens the history drawer and clicks a closed chat panel
- **THEN** the panel is added back to the grid (split right of the focused panel, or as the sole panel if the grid is empty) and its conversation history is loaded

#### Scenario: Close a terminal panel
- **WHEN** the user closes a terminal panel
- **THEN** the panel is removed from the grid and the terminal's PTY is terminated; the panel appears in history with a "disconnected" state and can be re-opened with a fresh PTY

#### Scenario: Close the last panel
- **WHEN** the user closes the sole remaining panel in the grid
- **THEN** the grid shows the empty state and the closed panel appears in history

### Requirement: History drawer UI
The history drawer SHALL list closed panels for the active project, newest first, showing the panel title, type icon, and a relative timestamp of when it was closed. Each row has a "Re-open" action and a "Delete permanently" action (confirm-gated). The drawer is dismissable by clicking outside or pressing Escape.

#### Scenario: History drawer shows closed panels
- **WHEN** the user opens the history drawer
- **THEN** a list of closed panels is shown with title, type icon, and relative close time

#### Scenario: Delete permanently
- **WHEN** the user clicks "Delete permanently" on a history entry and confirms
- **THEN** the panel's session is deleted from the DB (chat messages removed, terminal PTY discarded) and the entry is removed from history

### Requirement: No silent side effects on close or restore
Closing a panel SHALL NOT delete its session, commit, push, or trigger any backend side effect. Restoring a panel from history SHALL NOT auto-send messages, auto-spawn terminals, or auto-start agents. Terminal panels restored from history show a "disconnected" state until the user explicitly reconnects.

#### Scenario: Close does not delete
- **WHEN** a chat panel is closed
- **THEN** the chat session row and all its messages remain in the database

#### Scenario: Restore does not auto-send
- **WHEN** a chat panel is re-opened from history
- **THEN** the conversation history is loaded but no new message is sent to the provider until the user explicitly sends one
