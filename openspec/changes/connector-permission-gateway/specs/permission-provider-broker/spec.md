## ADDED Requirements

### Requirement: Central Connector Permission Broker
The system SHALL route connector requests for commands, file access, provider claims, chat sync, web UI embedding, diagnostics, analytics, and external context through a centralized permission broker.

#### Scenario: Command permission requested
- **WHEN** a connector requests command execution outside an already-visible user-started terminal interaction
- **THEN** Basebuild prompts the user or applies an existing scoped rule before allowing the request

#### Scenario: File access permission requested
- **WHEN** a connector requests file reads or writes outside the active project scope or beyond its granted capability
- **THEN** Basebuild prompts the user with connector name, path scope, action type, and persistence options before access occurs

#### Scenario: Denied request
- **WHEN** the user denies a connector permission request
- **THEN** Basebuild blocks the action, records the denial, and returns a typed denial response to the connector

### Requirement: Provider Claim Consent
The system SHALL require explicit user consent before adding or enabling a provider/model account discovered from a connector-owned login or subscription.

#### Scenario: OMP reports provider subscription
- **WHEN** the OMP connector reports that OMP has access to an OpenAI subscription or another provider
- **THEN** Basebuild shows a prompt such as `OMP wants to add OpenAI subscription as a provider` with allow, deny, details, and scope options

#### Scenario: User allows provider claim
- **WHEN** the user allows a connector provider claim
- **THEN** Basebuild records a local provider entry that references the connector as the credential owner unless the user separately configures Basebuild-owned credentials

#### Scenario: User denies provider claim
- **WHEN** the user denies a connector provider claim
- **THEN** Basebuild does not add the provider to native provider lists and the connector cannot use that provider through Basebuild UI surfaces without asking again under the selected rules

### Requirement: Permission Audit Trail
The permission broker SHALL record connector permission decisions and sensitive connector events in a local audit trail.

#### Scenario: Permission decision recorded
- **WHEN** the user allows or denies a connector permission request
- **THEN** the audit trail records connector id, capability, requested scope, decision, persistence, timestamp, and project/session context without storing prompt text or secrets by default

#### Scenario: Audit visible
- **WHEN** the user opens connector security or provider settings
- **THEN** Basebuild shows recent permission decisions and lets the user revoke persisted connector grants

#### Scenario: Grant revoked
- **WHEN** the user revokes a persisted connector grant
- **THEN** future connector requests for that scope return to ask/deny behavior and active sessions are notified if their capability is affected

### Requirement: Privacy Defaults
The permission broker SHALL default to local-only, ask-before-side-effect behavior for every connector.

#### Scenario: Fresh connector install
- **WHEN** a new connector is registered
- **THEN** command execution, file writes, provider imports, web UI embedding, diagnostics collection, analytics collection, and analytics upload are denied or ask-gated by default

#### Scenario: Connector requests upload
- **WHEN** a connector requests analytics or diagnostic upload
- **THEN** Basebuild denies it unless the user has explicitly enabled both local collection and remote upload for that connector and endpoint
