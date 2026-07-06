## MODIFIED Requirements

### Requirement: Chronological Message Stream
The system SHALL render a chat's conversation as a strict chronological stream of events: user messages, assistant messages, reasoning folds, and tool-call cards SHALL appear in the order they occurred (by timestamp + sort order), not grouped by type. Tool-call cards SHALL render inline at their chronological position, not in a separate "tool events" section.

#### Scenario: Thinking → tool call → message in order
- **WHEN** a chat turn produces a reasoning chunk, then a tool call, then a text response
- **THEN** the conversation renders: reasoning fold, then tool-call card, then assistant message bubble — in that order, separated only by their timestamps

#### Scenario: Interleaved tool calls
- **WHEN** a chat turn produces tool call A, then a partial text response, then tool call B, then the final text
- **THEN** the conversation renders tool A, the partial text, tool B, and the final text in that chronological order

#### Scenario: Approval card inline
- **WHEN** a tool approval request appears during streaming
- **THEN** the approval card renders at its chronological position (after the last event, before the next) — not in a separate "live events" bucket

### Requirement: Reasoning Fold Chronology
The system SHALL render reasoning (thinking) content as an inline fold at its chronological position — before the assistant message it precedes, not after or grouped separately. The fold SHALL be collapsible and show a "thinking" label with a timestamp.

#### Scenario: Reasoning before response
- **WHEN** the provider sends reasoning tokens followed by response tokens
- **THEN** the reasoning fold renders immediately before the assistant message bubble

#### Scenario: No reasoning
- **WHEN** a turn produces no reasoning tokens
- **THEN** no reasoning fold renders and the message bubble appears without a preceding fold
