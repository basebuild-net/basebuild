## ADDED Requirements

### Requirement: OMP RPC Process Management
The system SHALL manage OMP as a long-lived RPC child process owned by the Rust core.

#### Scenario: Start OMP RPC session
- **WHEN** a project becomes active and OMP is available
- **THEN** the Rust core launches `omp --mode rpc` with the project folder as the working directory
- **AND** reads JSONL frames from stdout
- **AND** writes JSONL commands to stdin

#### Scenario: Surface OMP startup failure
- **WHEN** OMP cannot be launched or does not emit a ready frame
- **THEN** the app shows an actionable requirement or error state instead of silently failing

### Requirement: OMP State Surface
The system SHALL surface OMP state in the UI through structured RPC data, not terminal scraping.

#### Scenario: Load OMP model and session state
- **WHEN** the UI requests current OMP state
- **THEN** the app uses RPC commands such as `get_state`, `get_available_models`, and `get_login_providers`
- **AND** displays model, provider, session, task, and context status from structured responses

### Requirement: OMP Prompt Execution
The system SHALL allow the UI to send prompts and control OMP runs through RPC.

#### Scenario: Run prompt from UI
- **WHEN** the user starts an agent action from the UI
- **THEN** the Rust core sends an OMP `prompt` RPC command
- **AND** streams OMP events back to the frontend as Tauri events

#### Scenario: Abort running prompt
- **WHEN** the user aborts an active OMP run
- **THEN** the Rust core sends the appropriate OMP abort command
- **AND** the UI reflects the stopped state
