## ADDED Requirements

### Requirement: Provider-Backed Turn Execution
The native harness SHALL execute each chat turn against the provider and model selected for that turn, rather than returning a fixed local response for all turns.

#### Scenario: Configured provider handles the turn
- **WHEN** the user sends a turn with a provider that has a stored, valid credential
- **THEN** the harness dispatches the request to that provider's API using the selected model and effort, and returns the provider's actual assistant output

#### Scenario: Per-turn model routing
- **WHEN** consecutive turns in one session use different providers or models
- **THEN** each turn is routed to its own provider/model and its assistant message and metrics record the provider/model that produced it

#### Scenario: Real metrics captured
- **WHEN** a provider-backed turn completes
- **THEN** the recorded metrics reflect the real request (time-to-first-token, total latency, input/output tokens) rather than synthesized values

### Requirement: Explicit Offline Fallback
The native harness SHALL treat the local coordinator as an explicit, clearly labeled offline fallback and SHALL NOT present canned local output as if a provider had answered.

#### Scenario: Local coordinator is labeled
- **WHEN** a turn is handled by the local coordinator because no provider is configured
- **THEN** the response is labeled as an offline/local-coordinator turn and the UI indicates that no external model was contacted

#### Scenario: Setup required instead of silent failure
- **WHEN** the user sends a turn to a provider that has no stored credential
- **THEN** the harness returns a typed setup-required result that the composer renders as an inline connect prompt, without discarding the drafted message
