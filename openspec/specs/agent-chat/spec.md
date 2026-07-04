# agent-chat Specification

<!-- Created from MODIFIED delta of change 'chat-context-defaults'; base ADDED requirements live in the still-active 'stabilize-and-agent-chat' change. When that change archives, skip same-named requirements — these versions are newer. -->

## Requirements

### Requirement: Chat Draft Injection
The system SHALL allow other workflows to focus a chat tab and place a generated draft prompt into the chat input without sending it automatically.

#### Scenario: Inject draft into existing chat
- **WHEN** a workflow requests chat with a draft prompt and the active session already has at least one chat tab
- **THEN** the system focuses the existing chat tab, displays the chat panel, and replaces the chat input draft with the requested prompt

#### Scenario: Inject draft into new chat
- **WHEN** a workflow requests chat with a draft prompt and the active session has no chat tabs
- **THEN** the system creates a new chat tab, focuses it, displays the chat panel, and places the requested prompt in the chat input

#### Scenario: User reviews before send
- **WHEN** a draft prompt is injected and the user has not enabled an explicit auto-send default
- **THEN** the prompt remains in the chat input and is not sent to the adapter until the user presses Send or Enter

#### Scenario: Explicit auto-send default
- **WHEN** a draft prompt is injected and the user has enabled the explicit auto-send generated prompts default
- **THEN** the prompt is sent only after permission checks pass, and the chat records the user message visibly before streaming any assistant response

### Requirement: OMP Default Chat Adapter
The system SHALL use OhMyPi (OMP) as the default chat adapter while keeping the chat UI independent of adapter-specific process details.

#### Scenario: Start default chat
- **WHEN** the user opens a chat tab without changing settings
- **THEN** the chat starts using the configured OMP adapter command in the active project directory

#### Scenario: Adapter unavailable
- **WHEN** the configured adapter executable is missing or fails to start
- **THEN** the chat displays a recoverable system error with adapter name, executable, and next action, without crashing the workspace

#### Scenario: Adapter switch preserves UI
- **WHEN** the default chat adapter is changed in settings
- **THEN** new chat sessions use the selected adapter while the ChatPanel message list, input, loading state, and error rendering continue through the same UI contract

### Requirement: Agent Capability Surface
The system SHALL expose typed adapter capabilities for chat messages, skills, providers, information, and commands so OMP features can be connected without hardcoding them into React components.

#### Scenario: Load capabilities
- **WHEN** a chat adapter starts
- **THEN** the frontend can request the adapter's supported capabilities, including chat, skills, providers, commands, and information endpoints

#### Scenario: Unsupported capability
- **WHEN** the UI requests a capability the active adapter does not support
- **THEN** the backend returns a typed unsupported-capability error and the UI displays it inline with an actionable message

#### Scenario: OMP skills visible
- **WHEN** the OMP adapter reports available skills
- **THEN** the chat UI can render those skills as selectable context or commands without knowing OMP-specific command syntax

### Requirement: Message Streaming Integrity
The system SHALL maintain coherent chat turns when adapter output streams over a PTY or structured RPC channel.

#### Scenario: Streaming assistant response
- **WHEN** the adapter emits assistant output chunks for a message
- **THEN** the chat appends chunks to the current assistant turn instead of creating unrelated messages for each chunk

#### Scenario: Command echo handling
- **WHEN** a PTY-backed adapter echoes user input or control sequences
- **THEN** the chat filters or marks echoes so user-entered text does not appear as assistant content

#### Scenario: Agent session closes
- **WHEN** the adapter process exits
- **THEN** the chat marks the session ended, disables send until restarted, and retains visible conversation history

### Requirement: Agent Chat Panel
The system SHALL provide a non-terminal chat panel that communicates with CLI agents via structured RPC, rendering messages as a scrollable conversation.

#### Scenario: User opens a chat tab
- **WHEN** the user clicks "+" in the workspace tab bar and selects "Chat"
- **THEN** a new chat tab is created and the agent chat panel is displayed

#### Scenario: User sends a message
- **WHEN** the user types a message and presses Enter (or clicks Send)
- **THEN** the message is sent to the configured agent adapter, and the response is rendered as a new assistant message in the conversation

#### Scenario: Agent is processing
- **WHEN** the agent is processing a request
- **THEN** the chat panel shows a loading indicator and disables the send button

### Requirement: Agent Adapter Architecture
The system SHALL use an agent-agnostic adapter pattern so multiple CLI agents (OMP, Claude Code, Codex CLI) can be supported without changing the chat UI.

#### Scenario: Default adapter
- **WHEN** the app starts
- **THEN** the OhMyPi adapter is used by default

#### Scenario: Adapter selection (future)
- **WHEN** additional adapters are registered
- **THEN** the user can select between them in the chat panel header

### Requirement: Unsupported Feature Error Surfacing
The system SHALL catch unsupported OMP features and surface them in the error UI rather than crashing.

#### Scenario: Unsupported feature encountered
- **WHEN** the agent adapter receives a response containing an unsupported feature
- **THEN** the error is logged to the warnings/errors panel with an "unsupported" tag and the chat panel shows an inline error message
