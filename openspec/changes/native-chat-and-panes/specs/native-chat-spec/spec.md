## ADDED Requirements

### Requirement: Native OMP Chat Backend
The system SHALL run an OMP PTY process behind each chat tab, streaming output to the frontend via events, and persisting conversation messages to the database.

#### Scenario: User opens a chat tab
- **WHEN** the user creates a new chat tab
- **THEN** an OMP PTY process is spawned in the project directory and its output is streamed to the chat panel

#### Scenario: User sends a message in chat
- **WHEN** the user types a message and presses Enter
- **THEN** the message is written to the OMP PTY stdin and the message is persisted to the database

#### Scenario: Agent output is received
- **WHEN** the OMP PTY emits output
- **THEN** the output is parsed into structured messages (user, assistant, tool-call, file-change) and persisted to the database

#### Scenario: Chat tab is restored after restart
- **WHEN** the app restarts and a chat tab is restored from the session
- **THEN** the conversation messages are loaded from the database and displayed in the chat panel

### Requirement: Chat View Toggle
The system SHALL provide a view toggle in each chat tab allowing the user to switch between "Chat" (structured UI), "Terminal" (raw PTY), and "Debug" (side-by-side) views.

#### Scenario: User switches to terminal view
- **WHEN** the user clicks "Terminal" in the view toggle
- **THEN** an xterm.js terminal is shown connected to the same OMP PTY, displaying raw terminal output

#### Scenario: User switches to debug view
- **WHEN** the user clicks "Debug" in the view toggle
- **THEN** the tab is split into two panes: terminal on the left, chat on the right, both connected to the same OMP PTY

#### Scenario: User switches back to chat view
- **WHEN** the user clicks "Chat" in the view toggle
- **THEN** only the structured chat UI is shown, the terminal pane is hidden

### Requirement: Structured Message Rendering
The system SHALL parse OMP output and render structured message types in the chat UI instead of raw terminal text.

#### Scenario: Assistant message rendered
- **WHEN** the OMP adapter detects an assistant message in the output
- **THEN** the message is rendered as a chat bubble with the "assistant" role label

#### Scenario: Tool call rendered
- **WHEN** the OMP adapter detects a tool call in the output
- **THEN** a tool-call card is rendered with the tool name, arguments, and result

#### Scenario: Unparseable output rendered as fallback
- **WHEN** the OMP adapter cannot parse the output into a structured message
- **THEN** the raw text is rendered in a preformatted text block

### Requirement: Chat Conversation Persistence
The system SHALL persist all chat messages to a `chat_messages` table in the database and restore them when the chat tab is reopened.

#### Scenario: Messages are saved
- **WHEN** a message is sent or received in a chat tab
- **THEN** the message is saved to the `chat_messages` table with: id, session_id, agent_id, role, content, metadata, created_at

#### Scenario: Messages are restored
- **WHEN** a chat tab is reopened after app restart
- **THEN** all previously saved messages are loaded from the database and displayed in the chat panel
