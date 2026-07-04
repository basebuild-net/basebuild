## ADDED Requirements

### Requirement: Attach to a running OMP session (read-only)

The system SHALL attach to a live OMP session as a telemetry source without taking ownership
of the session. Attachment MUST be read-only with respect to the agent: it MUST NOT alter the
OMP conversation, model, effort, or configuration.

The primary attach path SHALL read the active OMP profile's local ledgers
(`~/.omp/stats.db`, `~/.omp/agent/agent.db`, resolved for the active profile) and
`omp usage --json`. This path works whether the IDE spawned the OMP terminal (a raw PTY TUI)
or OMP is running externally. Reads MUST be read-only and tolerate a concurrently-writing OMP
process (e.g. read-only/immutable connection, no write lock).

OMP's stdio RPC mode (`omp --mode rpc`) is a distinct, non-terminal protocol: a single OMP
process runs EITHER as a raw TUI terminal OR in RPC mode, not both. RPC MAY be supported later
as an optional richer, event-driven telemetry source, but the terminal tab and its telemetry
SHALL NOT depend on it.

#### Scenario: Telemetry for an IDE-spawned OMP terminal

- **WHEN** the IDE spawns an OMP terminal tab and OMP begins writing to its ledgers
- **THEN** the system establishes a read-only telemetry attachment for that session's profile and begins surfacing live context from the ledgers and `omp usage --json`

#### Scenario: Telemetry for an externally running OMP session

- **WHEN** OMP is running outside the IDE and its profile ledgers are readable
- **THEN** the system attaches read-only to those ledgers and surfaces the same live context, without spawning or restarting OMP

#### Scenario: No OMP session is running

- **WHEN** no readable OMP ledger exists for the active profile and no OMP process is detected
- **THEN** telemetry reports a `detached` state with a reason, and the system does not error or spawn any process

#### Scenario: Attachment never mutates the agent

- **WHEN** the system is attached to an OMP session
- **THEN** it only performs read-only reads and never writes to OMP databases or sends any command that changes the model, effort, conversation, or configuration

### Requirement: Surface per-message provider, plan, and model

For each agent message observed in an attached OMP session, the system SHALL resolve and
expose the provider, the provider plan in use, and the model id. When a field cannot be
resolved it SHALL be reported as `unknown` rather than fabricated or defaulted.

Plan attribution SHALL be derived from OMP's local plan signals (`agent.db` `usage_history`
plan windows and `auth_credentials`) and, when the account sync capability has fresh data,
MAY be reconciled with the account's detected plan; the source of the plan value SHALL be
recorded (`local` vs `account`).

#### Scenario: Message carries provider and model from the ledger

- **WHEN** a message is recorded in `stats.db` with its provider and model
- **THEN** the telemetry record for that message includes that provider and model id

#### Scenario: Plan resolved from local OMP ledgers

- **WHEN** a message's provider has an active plan window in `agent.db` `usage_history`
- **THEN** the telemetry record includes the plan tier for that provider with `planSource = "local"`

#### Scenario: Unresolvable field reported as unknown

- **WHEN** the plan or model for a message cannot be determined from any source
- **THEN** the telemetry record reports that field as `unknown` and does not substitute a default value

### Requirement: Surface effort/thinking level when available

The system SHALL expose the effort/thinking level in play for the session when it can be
resolved (e.g. from the session's `thinking_level_change` metadata, or a richer live source if
one is attached). Because OMP does not persist a thinking level on every request, the effort
SHALL be reported as `unknown` when it cannot be resolved, never guessed.

#### Scenario: Effort surfaced from session metadata

- **WHEN** the active session records a thinking-level change and no later change overrides it
- **THEN** the telemetry context reports that thinking level as the current effort

#### Scenario: Effort unknown rather than guessed

- **WHEN** no thinking-level signal is available for the session
- **THEN** the effort is reported as `unknown` and no default level is substituted

### Requirement: Per-message metrics

For each observed agent message the system SHALL expose the available per-message metrics:
input/output/cache tokens, total tokens, tokens-per-second, cost, TTFT, and duration, drawn
from `stats.db`. Missing metrics SHALL be omitted, not zero-filled.

#### Scenario: Completed message reports token and latency metrics

- **WHEN** a message's metrics are present in `stats.db`
- **THEN** the telemetry record includes the present metrics (tokens, cost, TTFT, duration) and omits any metric that is absent

### Requirement: Live provider usage context

The system SHALL expose a live usage context for the attached session's active provider(s):
the current plan, per-window utilization (5h and 7d `usedFraction`/`remainingFraction`),
`resetsAt`, and a severity indicator, sourced from OMP usage data (`agent.db` cache
`usage_cache:report:*` and/or `omp usage --json`). Every usage-context value SHALL carry an
explicit freshness marker (measured-at / age) so a stale value is never presented as current.

#### Scenario: Live utilization surfaced with freshness

- **WHEN** OMP usage data reports the active provider is at 62% of its 5h window
- **THEN** the usage context exposes `usedFraction = 0.62` for the 5h window with `resetsAt`, a severity level, and the age of the measurement

#### Scenario: Stale usage flagged, not hidden

- **WHEN** the latest available OMP usage measurement is older than the freshness threshold
- **THEN** the usage context marks the value as stale (rather than omitting it) so the UI can render it dimmed with its age

### Requirement: Read-only privacy boundary

Telemetry capture SHALL ingest only usage/metadata (provider, plan, model, effort, tokens,
cost, timing, window utilization). It SHALL NOT read, store, or emit prompt text, assistant
response text, source code, terminal output, secrets, or raw absolute filesystem paths. Any
local persistence of telemetry metrics SHALL be gated on the `allowUsageAnalyticsCollection`
permission; live in-memory display does not require that permission.

#### Scenario: Prompt and response content excluded

- **WHEN** telemetry is captured from an OMP session whose ledgers contain prompt and response content
- **THEN** the resulting telemetry records contain no prompt text, response text, or source content — only usage/metadata fields

#### Scenario: Persistence gated on collection permission

- **WHEN** `allowUsageAnalyticsCollection` is off
- **THEN** telemetry is shown live in the UI but no telemetry metrics are written to the local ledger

### Requirement: Telemetry event channel

The system SHALL publish telemetry updates to the frontend over a dedicated event channel so
the UI reflects the current message context, per-message metrics, and live usage context
without polling. Attachment state changes (attached / detached / stale) SHALL be published on
the same channel.

#### Scenario: UI receives live updates on state change

- **WHEN** the attached OMP session changes model or effort level mid-session
- **THEN** a telemetry update carrying the new model/effort is published on the event channel and the UI updates without a manual refresh

#### Scenario: Detachment is published

- **WHEN** an attached OMP session ends (process exits) or its ledgers become unreadable
- **THEN** a `detached` telemetry state is published so the UI can show a disconnected indicator instead of stale-live data
