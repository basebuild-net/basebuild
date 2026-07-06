# context-budget-guard Specification (delta)

## MODIFIED Requirements

### Requirement: Token budget enforcement
Before each provider request, the system SHALL estimate request tokens (existing
estimator) against the active model's context window from the catalog (with a
conservative default when unknown) minus a reserved output margin. When over
budget and compaction is enabled, the system SHALL first attempt to compact the
oldest non-system turns into a durable summary (see the `session-compaction`
capability); if the request still does not fit, or compaction is disabled or
unavailable, oldest non-system turns SHALL be dropped whole (message + its tool
events) until the request fits. In all cases the system prompt, the latest user
message, and the current loop iteration's tool results SHALL be preserved.

#### Scenario: Long session gets truncated
- **WHEN** a session's history exceeds the model budget and compaction is disabled
- **THEN** the request is trimmed by dropping oldest turns first, the turn succeeds, and a truncation notice appears in the transcript

#### Scenario: Compaction preferred over dropping
- **WHEN** a session's history exceeds the model budget and compaction is enabled
- **THEN** the oldest turns are summarized into a compaction message first, and whole-turn dropping occurs only if the summarized history still overflows

#### Scenario: Single oversized turn
- **WHEN** the latest user message plus mandatory context alone exceeds the budget
- **THEN** the send is rejected with a clear error naming the limit — never a silent provider 400
