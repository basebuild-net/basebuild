# session-compaction Specification (delta)

## ADDED Requirements

### Requirement: Summarize-and-continue compaction
When compaction is enabled, the system SHALL compact the oldest non-system
conversation turns into a single durable summary message as a session approaches
the model budget, instead of dropping that history outright. The summary SHALL
capture decisions, facts, and open threads sufficient to continue the task, and
compaction SHALL always preserve the system prompt, the latest user message, and
the current loop iteration's tool results.

#### Scenario: Compaction on approaching budget
- **WHEN** a session's estimated tokens reach the configured compaction threshold
- **THEN** the oldest non-system turns are summarized into one compaction message inserted in their place, and the conversation continues without losing the current turn

#### Scenario: Preserved anchors
- **WHEN** compaction runs
- **THEN** the system prompt, the latest user message, and the current iteration's tool results are never summarized away

#### Scenario: Compaction disabled
- **WHEN** compaction is disabled and the session exceeds the budget
- **THEN** the system uses the existing whole-turn drop behavior with no summary message

### Requirement: Compaction visibility and durability
Compaction SHALL be visible in the transcript and SHALL persist so it survives
restart.

#### Scenario: Visible compaction notice
- **WHEN** a compaction occurs
- **THEN** a compaction notice naming the summarized span appears in the transcript, distinct from the hard-truncation notice

#### Scenario: Survives restart
- **WHEN** the app restarts after a compaction
- **THEN** the stored summary is reloaded in place of the summarized turns, and the session does not re-expand to the pre-compaction history

### Requirement: Safe fallback
Compaction SHALL never block a send silently; on failure it SHALL fall back to
hard truncation.

#### Scenario: Summarization fails
- **WHEN** the summarization request fails or times out
- **THEN** the system falls back to dropping oldest turns whole to fit the budget, the turn still succeeds, and the failure is noted in the transcript — never a silent provider 400
