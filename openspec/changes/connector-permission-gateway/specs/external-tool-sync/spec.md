## ADDED Requirements

### Requirement: Project And Session Sync
The system SHALL synchronize connector project/session state into Basebuild when the connector supports it and the user has granted required permissions.

#### Scenario: Connector binds to project
- **WHEN** a connector session starts for a project
- **THEN** Basebuild records the connector session id, project path, runtime profile, capabilities, sync status, and last activity locally

#### Scenario: Chat session syncs
- **WHEN** a connector emits supported chat message or turn metadata events
- **THEN** Basebuild updates the corresponding chat projection without treating terminal control sequences as trusted structured data

#### Scenario: Sync conflict
- **WHEN** connector state and Basebuild state diverge or the connector reports an older revision
- **THEN** Basebuild shows a sync warning and avoids overwriting newer local state silently

### Requirement: Raw And Native View Toggle
The system SHALL allow users to switch between a connector's raw surface and Basebuild's native projection when both are available.

#### Scenario: Raw terminal selected
- **WHEN** the user chooses raw terminal view for a connector session
- **THEN** Basebuild shows the underlying PTY/terminal surface with clear connector identity and does not hide tool output from the user

#### Scenario: Native projection selected
- **WHEN** the user chooses native view for a connector session
- **THEN** Basebuild shows structured chat/status/provider/skill UI derived from connector events and marks any unsupported or inferred fields clearly

#### Scenario: Toggle preserves session
- **WHEN** the user toggles between raw terminal and native projection
- **THEN** Basebuild keeps one connector session/process association and does not start duplicate tool processes solely because the view changed

### Requirement: Skills Commands And Models Sync
The system SHALL display connector-exposed skills, commands, models, and provider status through typed UI contracts when permissioned and supported.

#### Scenario: Connector reports skills
- **WHEN** a connector reports skills or slash commands for the active project
- **THEN** Basebuild can display them as selectable chat/context actions with connector attribution

#### Scenario: Connector reports models
- **WHEN** a connector reports available models through an approved provider claim
- **THEN** Basebuild displays those models with provider, connector ownership, and availability status

#### Scenario: Unsupported sync surface
- **WHEN** a connector cannot report skills, models, commands, or provider status
- **THEN** Basebuild omits that surface or shows unsupported-capability messaging without failing the whole connector session

### Requirement: Web UI And Collaboration Bridge
The system SHALL support connector web UI or collaboration surfaces only through explicit local bridge registration, origin checks, and user permission.

#### Scenario: Connector exposes local web UI
- **WHEN** a connector advertises a local web UI or collaboration endpoint
- **THEN** Basebuild asks before embedding or synchronizing it and shows the connector name, origin, data scopes, and persistence options

#### Scenario: Origin not allowed
- **WHEN** a connector tries to embed or sync from an unapproved origin
- **THEN** Basebuild blocks the bridge and records an audit event

#### Scenario: User opens supported collab UI
- **WHEN** the user allows a connector collaboration bridge
- **THEN** Basebuild can show the web UI or synchronized chat state inside the workspace while preserving a visible boundary between Basebuild UI and connector-owned content
