## ADDED Requirements

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
