# desktop-shell Specification

<!-- Created from MODIFIED delta of change 'chat-context-defaults'; base ADDED requirements live in the still-active 'stabilize-and-agent-chat' change. When that change archives, skip same-named requirements — these versions are newer. -->

## Requirements

### Requirement: Chat As Default Workspace Target
The system SHALL treat chat as a first-class center workspace tab target alongside terminal, file, schematic, and debug surfaces.

#### Scenario: Workflow opens chat
- **WHEN** any workflow requests an agent conversation
- **THEN** the center workspace switches to the terminal/chat tool area and focuses a chat tab

#### Scenario: Reuse active chat
- **WHEN** the currently active tab is already a chat tab
- **THEN** workflow prompt injection uses that active chat tab rather than creating another tab

#### Scenario: Reuse existing non-active chat
- **WHEN** a chat tab exists but is not active
- **THEN** workflow prompt injection focuses the most recently created chat tab unless the workflow requests a specific chat tab

### Requirement: Tab Metadata For Workflow Payloads
The system SHALL support passing workflow-specific payloads to tabs without overloading terminal IDs or file paths.

#### Scenario: Chat draft payload
- **WHEN** a workflow creates or focuses a chat tab with a draft prompt
- **THEN** the draft prompt is delivered through typed tab/workspace state and consumed by ChatPanel exactly once

#### Scenario: Existing tabs remain compatible
- **WHEN** the app loads tabs created before metadata support exists
- **THEN** terminal, file, schematic, and chat tabs still load with null or empty metadata

### Requirement: Tab Creation
The system SHALL create and switch to new workspace tabs when the user clicks "+" → Terminal, "+" → Schematic, or "+" → Chat.

#### Scenario: Create terminal tab
- **WHEN** the user clicks "+" and selects "Terminal"
- **THEN** a new terminal tab is created, a PTY is spawned, the tab becomes active, and the terminal panel is displayed

#### Scenario: Create schematic tab
- **WHEN** the user clicks "+" and selects "Schematic"
- **THEN** a new empty/schematic tab is created and becomes active, displaying the project schematic view

#### Scenario: Create chat tab
- **WHEN** the user clicks "+" and selects "Chat"
- **THEN** a new chat tab is created and becomes active, displaying the agent chat panel

### Requirement: File Opening
The system SHALL open files clicked in the Files panel as workspace tabs.

#### Scenario: Click a file
- **WHEN** the user clicks a file in the Files panel
- **THEN** a file tab is created with the file name, the file content is displayed in the FileViewer, and the tab becomes active

#### Scenario: Reopen an already-open file
- **WHEN** the user clicks a file that is already open in a tab
- **THEN** the existing tab is focused instead of creating a duplicate

### Requirement: Session Context Menu
The system SHALL provide a right-click context menu on sessions in the sidebar.

#### Scenario: Right-click a session
- **WHEN** the user right-clicks a session
- **THEN** a context menu appears with: Rename, Delete

#### Scenario: Rename from context menu
- **WHEN** the user clicks "Rename" in the session context menu
- **THEN** the session name becomes editable inline

#### Scenario: Delete from context menu
- **WHEN** the user clicks "Delete" in the session context menu
- **THEN** a confirmation prompt appears, and on confirm the session is deleted

### Requirement: Autonomous Toolbar Removal
The system SHALL NOT display the autonomous toolbar in the workspace tab bar.

#### Scenario: Workspace without autonomy
- **WHEN** the workspace tab bar is rendered
- **THEN** no autonomous mode controls are visible; the tab bar contains only tabs and the "+" button
