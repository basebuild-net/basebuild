# privacy-usage-analytics Specification

## Requirements

### Requirement: Analytics Disabled Until Explicit Opt-In
The system SHALL ship with usage analytics and crash/diagnostic upload disabled until the user explicitly opts in.

#### Scenario: Fresh install
- **WHEN** the app starts for a new user
- **THEN** analytics collection and network upload are disabled by default

#### Scenario: User opts in
- **WHEN** the user explicitly enables usage analytics in settings or onboarding
- **THEN** the system records the consent version, timestamp, selected scopes, and persistence scope locally

#### Scenario: User opts out
- **WHEN** the user disables analytics after opting in
- **THEN** the system stops collecting analytics immediately and offers to delete previously stored local analytics events

### Requirement: Privacy-Safe Event Taxonomy
The system SHALL define a usage event taxonomy that excludes prompt text, chat message content, raw file paths, secrets, terminal output, and source code by default.

#### Scenario: Plan workflow event
- **WHEN** the user invokes `Generate from context`
- **THEN** analytics may record only privacy-safe metadata such as event name, feature area, outcome, durations, adapter id, and error class, subject to consent

#### Scenario: Prompt content present
- **WHEN** a workflow includes prompt text, schematic content, file content, or terminal output
- **THEN** analytics redacts or omits that content before any local event is stored

#### Scenario: Project path present
- **WHEN** an event references a project or file
- **THEN** analytics stores no raw absolute path unless the user has explicitly enabled a scoped diagnostic mode

### Requirement: Local Analytics Ledger
The system SHALL store analytics consent, pending events, and deletion state locally and make them inspectable by the user.

#### Scenario: View local analytics
- **WHEN** the user opens privacy settings
- **THEN** the user can see analytics status, selected scopes, last upload status if uploads are enabled, and local event counts

#### Scenario: Delete local analytics
- **WHEN** the user clicks delete analytics data
- **THEN** locally stored analytics events are deleted and the UI confirms the deletion

#### Scenario: Export local analytics
- **WHEN** the user exports analytics data
- **THEN** the system writes a human-readable local export containing only events allowed by the current privacy rules

### Requirement: Upload Requires Separate Permission
The system SHALL treat local analytics collection and remote upload as separate permissions.

#### Scenario: Local-only analytics enabled
- **WHEN** the user enables local usage analytics but not upload
- **THEN** events remain on the device and no analytics network request is made

#### Scenario: Remote upload enabled
- **WHEN** the user enables anonymous upload
- **THEN** the system uploads only events that pass redaction and scope checks, and exposes the destination and last upload result in settings

#### Scenario: Upload endpoint unavailable or undocumented
- **WHEN** no reviewed upload endpoint is configured
- **THEN** the remote upload toggle is disabled or hidden and no upload code path runs

### Requirement: Permission Audit Trail
The system SHALL maintain a local audit trail of permission prompts and decisions for sensitive agent/runtime actions.

#### Scenario: Permission decision recorded
- **WHEN** the user allows or denies command execution, external context, file modification, auto-send, analytics collection, or analytics upload
- **THEN** the system records the decision locally with action type, scope, decision, timestamp, and source workflow

#### Scenario: Audit trail inspected
- **WHEN** the user opens permissions settings
- **THEN** recent permission decisions are visible and can be revoked by scope

#### Scenario: Audit trail redaction
- **WHEN** an audit entry includes paths, prompts, command arguments, or model names
- **THEN** the entry stores redacted or scoped identifiers unless the user explicitly enables detailed diagnostics
