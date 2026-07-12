## ADDED Requirements

### Requirement: Transcript-first chat loading
Basebuild SHALL load an existing chat transcript and its interaction history without waiting for non-critical global metrics, branch metadata, or provider configuration reads to finish.

#### Scenario: Reopen existing chat
- **WHEN** a user opens a persisted chat
- **THEN** its messages, tool events, and pending interactions begin loading immediately while secondary header metadata hydrates independently

### Requirement: Frame-coalesced streaming
Basebuild SHALL coalesce high-frequency provider stream fragments so visible response state updates occur at most once per animation frame without dropping or reordering content.

#### Scenario: High-frequency response stream
- **WHEN** a provider emits multiple content or reasoning fragments between rendered frames
- **THEN** Basebuild displays their concatenated content in order with one renderer state update for that frame

### Requirement: Latest-message following
The transcript SHALL follow newly sent and streamed content while the user is at the bottom, stop following after an intentional upward scroll, and resume when the user returns to the bottom or activates the latest-message control.

#### Scenario: Response arrives at transcript bottom
- **WHEN** the user is following the latest message and a response grows
- **THEN** the newest visible response remains in view without manual scrolling

#### Scenario: User reviews earlier content
- **WHEN** the user scrolls away from the bottom during a response
- **THEN** Basebuild preserves that reading position and exposes a control that resumes latest-message following

### Requirement: Compact single-location chat controls
Basebuild SHALL place model, effort, permission mode, branch, run state, and context usage in one compact sticky header and SHALL not duplicate those values in the composer footer or transcript.

#### Scenario: Chat is ready
- **WHEN** the chat panel renders
- **THEN** model selection, effort selection, textual permission mode, compact branch context, run state, and a context indicator are available from the header with tooltips

#### Scenario: Composer receives focus
- **WHEN** the user focuses the message textarea
- **THEN** the composer receives the orange focus treatment around the complete input area

### Requirement: Measured context indicator
Basebuild SHALL display the latest recorded session token usage against the selected model's context window when both values are available and SHALL distinguish a genuinely unavailable measurement from zero usage.

#### Scenario: Request metrics are available
- **WHEN** the selected model has a context window and the session has completed request metrics
- **THEN** the header context indicator shows the used percentage and exact token ratio in its tooltip

#### Scenario: New chat has not sent a request
- **WHEN** no request metric exists for the session
- **THEN** the context indicator shows an empty zero-usage state rather than the text "unknown usage"
