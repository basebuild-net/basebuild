## ADDED Requirements

### Requirement: Structured Native Chat Sessions
The system SHALL store and render native chat sessions as structured messages, assistant chunks, tool events, approval events, model metadata, provider metadata, and errors rather than as raw terminal transcripts.

#### Scenario: Assistant response streams
- **WHEN** the native harness emits assistant output chunks for a turn
- **THEN** the chat workspace appends chunks to the active assistant message while preserving turn order and metadata

#### Scenario: Tool event renders inline
- **WHEN** a native chat turn requests, starts, completes, or fails a tool action
- **THEN** the chat workspace renders the tool event inline with status, summary, and any required approval control

#### Scenario: Session reloads
- **WHEN** the app restarts and the user opens a previous native chat
- **THEN** the message list, tool events, model/provider metadata, errors, and final turn states reload from local storage

### Requirement: Multi-Chat Project Workspace
The system SHALL support multiple project-scoped chat sessions and allow users to open, switch, rename, close, and resume chats without losing history.

#### Scenario: New project chat
- **WHEN** the user creates a new chat while a project is active
- **THEN** the system creates a new project-scoped chat tab with the selected runtime profile, provider, and model defaults

#### Scenario: Switch between chats
- **WHEN** the user switches from one chat tab to another in the same project
- **THEN** each chat keeps its own messages, draft input, model/provider selection, loading state, and error state

#### Scenario: Resume previous chat
- **WHEN** the user reopens a saved chat session
- **THEN** the chat restores history and can continue only if the selected runtime/profile/provider is available or recoverably prompts for setup

### Requirement: Chat Controls And Rich Rendering
The chat workspace SHALL provide model/provider controls, visible approvals, markdown/code rendering, command/context affordances, and recoverable error states while following the Basebuild design contract.

#### Scenario: Model changed before send
- **WHEN** the user selects a different model before sending a native chat prompt
- **THEN** the outgoing turn records the chosen model and subsequent assistant output is associated with that model

#### Scenario: Approval prompt appears
- **WHEN** a tool action requires user consent
- **THEN** the chat displays an approval prompt with allow and deny actions, clear action details, persistence scope when applicable, and tooltips on interactive controls

#### Scenario: Rich content renders safely
- **WHEN** an assistant response includes markdown, code blocks, lists, links, or structured tool summaries
- **THEN** the chat renders readable content without executing embedded scripts or breaking the global stylesheet/design rules

### Requirement: Runtime Compatibility
The chat workspace SHALL continue to support existing runtime-profile adapters while adding native chat capabilities.

#### Scenario: OMP adapter selected
- **WHEN** a chat tab uses the OMP runtime profile
- **THEN** ChatPanel uses the same high-level message, input, loading, and error contract without requiring the native harness to own the OMP process

#### Scenario: Adapter lacks native feature
- **WHEN** the active runtime profile does not support a native chat feature such as model catalog, structured tool events, or persisted remote session resume
- **THEN** the UI degrades gracefully and shows typed unsupported-capability messaging where the user needs it
