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
