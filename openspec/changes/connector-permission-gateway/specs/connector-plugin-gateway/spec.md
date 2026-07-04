## ADDED Requirements

### Requirement: Connector Registry
The system SHALL maintain a local connector registry for external IDEs, CLIs, and tools that can integrate with Basebuild without being hardcoded into React components.

#### Scenario: Connector registers
- **WHEN** a connector manifest is added or detected
- **THEN** Basebuild records the connector id, name, executable/origin, supported transports, capabilities, version, trust status, and project binding rules locally

#### Scenario: Connector disabled
- **WHEN** the user disables a connector
- **THEN** Basebuild stops launching or syncing that connector while preserving its local settings, grants, and audit history for review

#### Scenario: Unknown connector requests access
- **WHEN** an unregistered connector attempts to communicate with Basebuild
- **THEN** the gateway rejects the request unless the user explicitly starts a connector registration flow

### Requirement: Capability Negotiation
The connector gateway SHALL negotiate capabilities before exposing connector-backed UI or actions.

#### Scenario: Capabilities loaded
- **WHEN** a connector starts
- **THEN** Basebuild requests or derives capabilities for chat, terminal, providers, models, skills, commands, files, diagnostics, web UI, and collaboration sync

#### Scenario: Capability unavailable
- **WHEN** the UI requests a connector feature that the connector does not support
- **THEN** the backend returns a typed unsupported-capability result and the UI shows a recoverable message

#### Scenario: Capability changes
- **WHEN** a connector version, login state, or project context changes its available capabilities
- **THEN** the connector gateway updates capability state and notifies the UI without requiring an app restart

### Requirement: Connector Lifecycle Isolation
The system SHALL keep connector processes and communication channels isolated from the Tauri process and stop connector side effects unless explicitly requested or permissioned.

#### Scenario: Launch connector
- **WHEN** the user starts a connector-backed session
- **THEN** Basebuild launches or attaches to the connector using the registered transport and records lifecycle state locally

#### Scenario: Connector crashes
- **WHEN** a connector process exits unexpectedly or its transport disconnects
- **THEN** Basebuild marks connector state as disconnected, preserves visible session history, and offers a restart action without crashing the app

#### Scenario: Startup restore
- **WHEN** Basebuild restores a project that previously used a connector
- **THEN** it restores connector UI metadata but does not launch the connector until the user explicitly opens/resumes that connector session or has an applicable grant

### Requirement: Developer Connector Contract
The system SHALL document a stable connector contract so future tool integrations can be implemented without changing Basebuild internals for every tool.

#### Scenario: Developer reads connector docs
- **WHEN** a developer wants to integrate a new CLI or IDE
- **THEN** documentation defines manifest fields, transport options, capability names, event schemas, permission request shapes, error codes, and local-first constraints

#### Scenario: Example connector runs
- **WHEN** the example connector is launched in development
- **THEN** Basebuild can register it, display capabilities, handle permission prompts, and show a test chat/terminal state without external network access
