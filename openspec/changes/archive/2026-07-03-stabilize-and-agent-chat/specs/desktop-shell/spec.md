## MODIFIED Requirements

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

### Requirement: Plan CRUD
The system SHALL persist plans and reflect changes immediately in the side panel.

#### Scenario: Create a plan
- **WHEN** the user clicks the create plan button
- **THEN** a new draft plan is created and appears in the "Draft" lane

#### Scenario: Edit a plan
- **WHEN** the user edits a plan and saves
- **THEN** the plan card updates with the new title, description, and goal

#### Scenario: Change plan status
- **WHEN** the user changes a plan's status
- **THEN** the plan moves to the corresponding status lane

### Requirement: Generate Plans with File Context
The system SHALL allow selecting a file as context for plan generation.

#### Scenario: Select context file
- **WHEN** the user clicks "Select context file" in the generate plan modal
- **THEN** a file picker opens, and the selected file's content is read and included as context

#### Scenario: No context available
- **WHEN** the user tries to generate plans without a project schematic or selected context file
- **THEN** a validation warning is shown
