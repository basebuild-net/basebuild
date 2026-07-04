# ide-workspace-state Specification

## Requirements

### Requirement: Project Workspace Restore
The system SHALL persist and restore the user's last focused project workspace state without silently launching terminals, agents, or external processes.

#### Scenario: App reopens last project
- **WHEN** the app starts after a successful previous project session
- **THEN** it focuses the last active project and restores the last selected session/chat/tab metadata from local state

#### Scenario: Stale process tab restored
- **WHEN** the restored active tab refers to a terminal or process-backed chat that is no longer running
- **THEN** the UI shows a stale/disconnected state and waits for explicit user action before reconnecting or starting a new process

#### Scenario: Missing project path
- **WHEN** the last focused project path no longer exists or is inaccessible
- **THEN** the app shows a recoverable project-missing state and does not delete the stored project record without user action

### Requirement: Persistent Resizable Layout
The system SHALL let users resize primary workspace columns and side panels and persist those sizes locally per project or workspace scope.

#### Scenario: Resize side panel
- **WHEN** the user drags or keyboard-adjusts a column resize handle
- **THEN** the affected panel width updates within defined min/max bounds and the value is persisted locally

#### Scenario: Restore layout width
- **WHEN** the project workspace is reopened
- **THEN** the previous valid panel widths are restored before the user interacts with the workspace

#### Scenario: Invalid stored width
- **WHEN** a stored panel width is missing, too small, too large, or incompatible with the current viewport
- **THEN** the system clamps or resets the width to a safe default without breaking the shell grid

### Requirement: Simplified Plans And Inspector Surface
The system SHALL simplify the plans/inspector area into clear, supportable side-panel sections with consistent icons, labels, and tooltips.

#### Scenario: Plans section opens
- **WHEN** the user opens the Plans side-panel section
- **THEN** the panel shows plan status, actions, and details without ambiguous inspector nesting or broken icon states

#### Scenario: Icon state changes
- **WHEN** a side-panel tab, plan action, or inspector action changes hover, active, disabled, or loading state
- **THEN** the icon and label remain visually consistent and accessible under the Basebuild design system

#### Scenario: Tooltip coverage
- **WHEN** the user hovers or focuses an interactive element in the shell, chat, plans, or panel resize controls
- **THEN** a `title` tooltip describes the action

### Requirement: No Silent Startup Side Effects
Workspace restore SHALL never execute agent, terminal, provider, install, sync, or file-writing side effects solely because a project or chat was restored.

#### Scenario: Last chat used provider
- **WHEN** a restored chat previously used a configured provider
- **THEN** the provider selection is shown, but no provider request is made until the user sends or resumes an action

#### Scenario: Last terminal was active
- **WHEN** the last active tab was a terminal
- **THEN** the restored UI shows the terminal tab metadata or disconnected state without launching a new shell automatically
