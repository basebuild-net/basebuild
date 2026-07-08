# desktop-shell Specification

## Purpose
Defines the desktop workspace shell, tab routing, panel creation, and project-level interaction boundaries.

<!-- Merges: ADDED requirements from 'stabilize-and-agent-chat' (archived 2026-07-03) and 'chat-context-defaults' (archived 2026-07-03); 'Renderer Crash Visibility' added from 'strong-testing-suite' (archived 2026-07-04). -->
## Requirements
### Requirement: Tab Creation
The system SHALL create and switch to new workspace tabs when the user clicks "+" → Terminal, "+" → Schematic, or "+" → Chat. A chat tab SHALL hold a chat grid container (per the `chat-grid-layout` capability) rather than a single chat panel; creating a chat tab initializes the grid with one new chat column focused.

#### Scenario: Create terminal tab
- **WHEN** the user clicks "+" and selects "Terminal"
- **THEN** a new terminal tab is created, a PTY is spawned, the tab becomes active, and the terminal panel is displayed

#### Scenario: Create schematic tab
- **WHEN** the user clicks "+" and selects "Schematic"
- **THEN** a new empty/schematic tab is created and becomes active, displaying the project schematic view

#### Scenario: Create chat tab
- **WHEN** the user clicks "+" and selects "Chat"
- **THEN** a new chat tab is created and becomes active, its grid initialized with one new chat column focused, displaying the agent chat panel inside that column

#### Scenario: Add chat to existing tab
- **WHEN** the user invokes "Add chat beside" from the active chat's header menu
- **THEN** a new chat column is added to the active chat tab's grid beside the currently focused chat, the grid layout updates (e.g. `1×1` → `1×2`), and the new chat column receives focus

### Requirement: Chat As Default Workspace Target
The system SHALL treat chat as a first-class center workspace tab target alongside terminal, file, schematic, and debug surfaces. When a workflow requests a chat, the system targets the active chat tab's grid (creating a new chat tab if none is active) and either reuses an existing chat column or adds a new one per the workflow's request.

#### Scenario: Workflow opens chat
- **WHEN** any workflow requests an agent conversation
- **THEN** the center workspace switches to the active chat tab (creating one if none is active) and either reuses the focused chat column or adds a new one as the workflow specifies

#### Scenario: Reuse active chat
- **WHEN** the currently active chat column is already a chat and the workflow requests reuse
- **THEN** workflow prompt injection uses that active chat column rather than creating another column

#### Scenario: Reuse existing non-active chat
- **WHEN** a chat column exists in the active tab's grid but is not active
- **THEN** workflow prompt injection focuses the most recently created chat column unless the workflow requests a specific chat column

### Requirement: Tab Metadata For Workflow Payloads
The system SHALL support passing workflow-specific payloads to tabs without overloading terminal IDs or file paths. The `draftPrompt` payload is delivered to a specific chat column within a tab's grid, not just to the tab.

#### Scenario: Chat draft payload
- **WHEN** a workflow creates or focuses a chat tab with a draft prompt
- **THEN** the draft prompt is delivered through typed tab/grid state and consumed by the target ChatPanel exactly once

#### Scenario: Existing tabs remain compatible
- **WHEN** the app loads tabs created before metadata support exists
- **THEN** terminal, file, schematic, and chat tabs still load with null or empty metadata

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

### Requirement: AutonomousToolbar Removal
The system SHALL NOT display the autonomous toolbar in the workspace tab bar.

#### Scenario: Workspace without autonomy
- **WHEN** the workspace tab bar is rendered
- **THEN** no autonomous mode controls are visible; the tab bar contains only tabs and the "+" button

### Requirement: Renderer Crash Visibility
The system SHALL show a visible crash report when the renderer encounters an uncaught render error or unhandled async error.

#### Scenario: Renderer crashes during user interaction
- **WHEN** a user interaction triggers an uncaught renderer error
- **THEN** the app shows a crash report with the error source and details instead of a black window

#### Scenario: User needs recovery actions
- **WHEN** the crash report is displayed
- **THEN** the user can reload the app UI and copy the error details for debugging

### Requirement: Panel Creation Affordances
The global `+` menu, activity-sidebar new-panel controls, panel-header split controls, file-open actions, schematic actions, history re-open, prompt routing, and plan-run events SHALL use the same checked panel insertion behavior. Each interactive action SHALL either create/focus the requested visible panel exactly once or show an actionable error; closing a menu without a visible result SHALL NOT be treated as success.

#### Scenario: Header menu and sidebar are consistent
- **WHEN** the user creates the same panel type from the header `+` menu or the activity sidebar
- **THEN** both affordances apply the same anchor resolution, pending state, focus, error, and cleanup behavior

#### Scenario: Process-backed option cannot disappear silently
- **WHEN** the user chooses Terminal or Oh My Pi and panel insertion or process startup fails
- **THEN** the shell shows the failure, leaves the existing workspace usable, and does not retain an unreachable process-backed tab

#### Scenario: Schematic and file use checked insertion
- **WHEN** the user opens the project schematic or a file while the stored active panel id is stale
- **THEN** the shell repairs/falls back to a live anchor and makes the requested panel visible and focused

### Requirement: Atomic project activation surface
The system SHALL treat project selection as a generation-guarded activation transaction and SHALL render a project loading surface before any project-scoped session, panel, planning, provider/model, or source state is shown. Content from the prior project SHALL be removed immediately; late responses from prior generations SHALL be ignored. Partial failure SHALL identify the failing subsystem and offer retry without exposing stale data.

#### Scenario: Rapid project switching settles only the final project
- **WHEN** the user selects projects A, B, and C before A or B finishes restoring
- **THEN** the shell paints loading feedback immediately, commits only C's state, and never shows an A/B chat, model, count, path, or warning under C

#### Scenario: A restore subsystem fails
- **WHEN** project detection succeeds but provider/model restore fails
- **THEN** the loading surface identifies provider/model restore as failed, offers retry, and does not reuse the previous project's provider/model

### Requirement: Single-flight folder selection
The system SHALL allow at most one native project-folder picker at a time across all entry points and SHALL expose the in-flight state on every folder trigger until the picker resolves or is cancelled.

#### Scenario: Folder action is invoked repeatedly
- **WHEN** the folder action is invoked several times before the native picker resolves
- **THEN** one native picker exists, later invocations are logged as skipped, and cancel returns the shell to its prior project without an error

### Requirement: Viewport-safe compact navigation
The system SHALL keep account menus, context menus, dialog actions, and required chat/workspace context fully visible and keyboard reachable at the supported 960×640 minimum and common Windows scale factors. Popovers SHALL flip or clamp at viewport edges rather than render off-screen.

#### Scenario: Bottom-left account menu opens at minimum size
- **WHEN** the app is 960×640 at 150% scale and the user opens the bottom-left account menu
- **THEN** the entire menu, Settings action, and Sign out action are visible within the viewport and reachable by keyboard
