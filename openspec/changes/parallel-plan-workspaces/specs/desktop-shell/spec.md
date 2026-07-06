## MODIFIED Requirements

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
