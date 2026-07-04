## ADDED Requirements

### Requirement: Token budget enforcement
Before each provider request, the system SHALL estimate request tokens (existing estimator) against the active model's context window from the catalog (with a conservative default when unknown) minus a reserved output margin. When over budget, oldest non-system turns SHALL be dropped whole (message + its tool events) until the request fits, always preserving the system prompt, the latest user message, and the current loop iteration's tool results.

#### Scenario: Long session gets truncated
- **WHEN** a session's history exceeds the model budget
- **THEN** the request is trimmed by dropping oldest turns first, the turn succeeds, and a truncation notice appears in the transcript

#### Scenario: Single oversized turn
- **WHEN** the latest user message plus mandatory context alone exceeds the budget
- **THEN** the send is rejected with a clear error naming the limit — never a silent provider 400

### Requirement: Oversized tool results
Tool results larger than a configured cap SHALL be stored in full locally but sent to the model truncated head+tail with an explicit truncation marker and the full size noted.

#### Scenario: Huge command output
- **WHEN** `run_command` produces 2 MB of output
- **THEN** the transcript stores/downloads the full output while the model receives the capped excerpt with a truncation marker
