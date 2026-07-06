## MODIFIED Requirements

### Requirement: Agent Chat Panel
The system SHALL provide a non-terminal chat panel that communicates with CLI agents via structured RPC, rendering messages as a scrollable conversation. The chat panel SHALL render inside a chat column within a chat grid tab, with a per-chat header (per the `chat-header-context` capability) above its conversation and a compact composer rail (per `chat-composer-controls`) above the input.

#### Scenario: User opens a chat tab
- **WHEN** the user clicks "+" in the workspace tab bar and selects "Chat"
- **THEN** a new chat tab is created with a single-column grid containing one new chat column, and the agent chat panel is displayed inside that column

#### Scenario: User sends a message
- **WHEN** the user types a message and presses Enter (or clicks Send)
- **THEN** the message is sent to the configured agent adapter, and the response is rendered as a new assistant message in the conversation

#### Scenario: Agent is processing
- **WHEN** the agent is processing a request
- **THEN** the chat panel shows a loading indicator and disables the send button

#### Scenario: Chat panel inside a grid cell
- **WHEN** the chat panel is rendered as one of multiple columns in a `1×N` or `M×N` grid
- **THEN** the panel's composer rail and input are fully visible and operable at the column's width (clamped to the minimum), and the conversation scrolls independently within the column

### Requirement: Chat Draft Injection
The system SHALL allow other workflows to focus a chat tab and place a generated draft prompt into a specific chat column's chat input without sending it automatically.

#### Scenario: Inject draft into existing chat
- **WHEN** a workflow requests chat with a draft prompt and the active chat tab's grid has at least one chat column
- **THEN** the system focuses the target chat column, displays its chat panel, and replaces the chat input draft with the requested prompt

#### Scenario: Inject draft into new chat
- **WHEN** a workflow requests chat with a draft prompt and the active chat tab's grid is empty or no chat tab exists
- **THEN** the system creates a new chat column (or a new chat tab if none is active), focuses it, displays the chat panel, and places the requested prompt in the chat input

#### Scenario: User reviews before send
- **WHEN** a draft prompt is injected and the user has not enabled an explicit auto-send default
- **THEN** the prompt remains in the chat input and is not sent to the adapter until the user presses Send or Enter

#### Scenario: Explicit auto-send default
- **WHEN** a draft prompt is injected and the user has enabled the explicit auto-send generated prompts default
- **THEN** the prompt is sent only after permission checks pass, and the chat records the user message visibly before streaming any assistant response
