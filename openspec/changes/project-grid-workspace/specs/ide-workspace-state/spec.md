## MODIFIED Requirements

### Requirement: Project Workspace Restore
The system SHALL persist and restore the user's last focused project workspace state — including the full panel grid layout (split tree, panel ids, sizes, types) — without silently launching terminals, agents, or external processes.

#### Scenario: App reopens last project
- **WHEN** the app starts after a successful previous project session
- **THEN** it focuses the last active project and restores the panel grid layout (split tree, panel sizes, panel types) from local state

#### Scenario: Stale process panel restored
- **WHEN** the restored grid includes a terminal panel whose PTY is no longer running
- **THEN** the panel shows a stale/disconnected state and waits for explicit user action before reconnecting

#### Scenario: Missing project path
- **WHEN** the last focused project path no longer exists or is inaccessible
- **THEN** the app shows a recoverable project-missing state and does not delete the stored project record without user action

### Requirement: Persistent Panel Grid Layout
The system SHALL persist the panel grid layout (split tree, panel ids, sizes, types) per project and restore it on project open. The layout SHALL be stored in the workspace-restore state blob, not in a separate DB table. Layout changes (split, resize, reorder) SHALL be debounced-persisted (250ms) to avoid thrashing.

#### Scenario: Resize a panel and reopen
- **WHEN** the user resizes a panel and reopens the project
- **THEN** the previous panel sizes are restored

#### Scenario: Split tree restored
- **WHEN** the user creates a 2×2 grid, closes the project, and reopens it
- **THEN** the 2×2 split tree is restored with the same panel types in the same positions

#### Scenario: Invalid stored layout
- **WHEN** a stored grid layout references a panel id that no longer exists (e.g. its chat session was deleted)
- **THEN** the system drops the orphaned panel from the tree and shows the remaining panels without error

### Requirement: No Silent Startup Side Effects
Workspace restore SHALL never execute agent, terminal, provider, install, sync, or file-writing side effects solely because a project or panel was restored.

#### Scenario: Restored chat panel
- **WHEN** a restored chat panel previously used a configured provider
- **THEN** the provider selection is shown, but no provider request is made until the user sends or resumes an action

#### Scenario: Restored terminal panel
- **WHEN** the grid includes a terminal panel from a previous session
- **THEN** the panel shows a disconnected state and does not spawn a new PTY until the user explicitly reconnects
