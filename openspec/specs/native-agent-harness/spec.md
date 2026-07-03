# native-agent-harness Specification

## Requirements

### Requirement: Native Runtime Profile
The system SHALL provide a Basebuild-owned native runtime profile that implements the shared agent runtime contract without requiring OMP or another external CLI to be the active chat engine.

#### Scenario: Native profile is available
- **WHEN** runtime profiles are listed on a fresh install or after migration
- **THEN** a `basebuild-native` chat-capable profile is available without removing the existing OMP profile

#### Scenario: Native chat starts in project context
- **WHEN** the user starts a native chat from a project workspace
- **THEN** the native harness starts a structured chat session scoped to that project and records the selected runtime profile, model, provider, and session metadata locally

#### Scenario: External CLI unavailable
- **WHEN** OMP or another external CLI is unavailable
- **THEN** the native runtime profile remains usable if its configured provider requirements are satisfied

### Requirement: Native Tool Permission Enforcement
The native harness SHALL route command execution, file modification, external context access, provider additions, and automatic sends through backend permission checks before performing the action.

#### Scenario: Tool approval required
- **WHEN** a native chat turn requests a command, file write, or external context read that lacks an allow rule
- **THEN** the system shows a permission prompt and does not execute the action until the user allows it

#### Scenario: Tool denial is recoverable
- **WHEN** the user denies a requested native harness action
- **THEN** the action is not performed, the denial is recorded in the audit trail, and the chat displays a recoverable denial notice

#### Scenario: Permission cannot be bypassed by UI state
- **WHEN** a frontend component calls a native harness command directly
- **THEN** the backend enforces the same permission decision before the side effect occurs

### Requirement: Native Provider And Model Catalog
The system SHALL expose provider accounts, model catalogs, selected defaults, and provider health through a local native provider/model service.

#### Scenario: Provider catalog loads
- **WHEN** the chat workspace opens provider/model controls
- **THEN** the UI can list locally configured providers, available models, current defaults, and provider status through typed backend commands

#### Scenario: Missing provider setup
- **WHEN** the selected native model requires a provider account that is not configured
- **THEN** the chat displays an actionable setup state instead of sending the request

#### Scenario: Provider credentials remain local
- **WHEN** a user configures a native provider
- **THEN** credential material is stored only in approved local secure storage or provider-owned local tooling and is not uploaded by Basebuild

### Requirement: Local Request Metrics Ledger
The native harness SHALL store OMP-stats-style request metrics locally for every native request without uploading prompt text, chat content, source code, secrets, terminal output, or raw absolute paths.

#### Scenario: Request metrics recorded
- **WHEN** a native chat request completes, fails, or is cancelled
- **THEN** the system records provider, model, effort level, request timestamps, duration, TTFT, TTLT, input tokens, output tokens, cache tokens where available, tokens per second, cost where available, outcome, and error class locally

#### Scenario: Metrics are queryable
- **WHEN** the UI asks for native request metrics
- **THEN** the backend returns recent local request rows and aggregate totals without requiring remote analytics consent

#### Scenario: Metrics exclude sensitive content
- **WHEN** request metrics are stored
- **THEN** prompt text, response text, source code, terminal output, secrets, and raw absolute paths are not stored in the metrics ledger

### Requirement: Dream-Derived Source Compliance
The system SHALL preserve license attribution and pass dependency review before copying or adapting Dream source, assets, or substantial implementation patterns.

#### Scenario: Dream code is adapted
- **WHEN** implementation copies or substantially adapts Dream code, UI assets, or source structure
- **THEN** the change includes required MIT copyright/license attribution and records the adapted source path for maintainers

#### Scenario: Electron-only dependency is proposed
- **WHEN** a Dream-derived implementation requires Electron-specific runtime behavior or unrelated dependency expansion
- **THEN** the implementation is rejected or redesigned for Basebuild's Tauri/Rust architecture before merge

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
