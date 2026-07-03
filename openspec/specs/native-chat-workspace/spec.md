# native-chat-workspace Specification

## Requirements

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
The chat workspace SHALL provide an always-visible composer that cannot be clipped, with visible model/provider/effort controls, a discoverable empty state, inline adapter-health/setup affordances, markdown/code rendering, and recoverable error states while following the Basebuild design contract.

#### Scenario: Composer is always visible
- **WHEN** a chat tab is open at any window size, including when the message list is empty or overflowing
- **THEN** the message list absorbs all overflow and the composer (model/provider/effort controls, text input, and send control) remains fully visible and interactive at the bottom of the panel, never pushed outside a clipped region

#### Scenario: Model and provider controls are discoverable
- **WHEN** the user looks at an open chat tab
- **THEN** the provider selector, model selector, and effort selector are visible in the composer without scrolling, hovering, or opening a menu, and each control has a tooltip describing its purpose

#### Scenario: Empty state guides first action
- **WHEN** a chat has no messages
- **THEN** the empty state names the active provider/model and points to the composer input and the "Connect provider" action so the user knows exactly where to type and how to enable a model

#### Scenario: Model changed before send
- **WHEN** the user selects a different model before sending a native chat prompt
- **THEN** the outgoing turn records the chosen model and subsequent assistant output is associated with that model

#### Scenario: Active adapter degraded
- **WHEN** the active chat adapter reports unavailable or setup-required health
- **THEN** the composer shows an inline health indicator and a "Set up" / "Connect" action instead of allowing a send that silently fails

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
