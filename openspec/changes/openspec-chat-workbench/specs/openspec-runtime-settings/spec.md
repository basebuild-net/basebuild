## ADDED Requirements

### Requirement: OpenSpec installation management
The system SHALL expose OpenSpec as an installable, updateable local tool in Settings. Detection SHALL report installed/missing/error states, version, executable path, schema support, and project readiness. Installing or updating OpenSpec SHALL require an explicit user click and SHALL NOT run silently during app startup or project open.

#### Scenario: Missing OpenSpec is actionable
- **WHEN** the user opens Settings → OpenSpec and no supported OpenSpec executable is available
- **THEN** the UI shows `Missing`, the reason, supported install sources, and an explicit `Install OpenSpec` action with a `title=` tooltip

#### Scenario: Install is explicit
- **WHEN** the user clicks `Install OpenSpec` and confirms the source/version
- **THEN** the backend runs the configured installer, records progress locally, and refreshes the detected OpenSpec status after completion

#### Scenario: Installed OpenSpec is healthy
- **WHEN** a supported OpenSpec executable is detected
- **THEN** Settings shows version, executable path, schema support, and `Ready` status without requiring network access

#### Scenario: Project readiness is checked
- **WHEN** a project is selected
- **THEN** Settings → OpenSpec shows whether that project has `openspec/config.yaml`, `openspec/specs/`, and writable `openspec/changes/`, with repair actions where safe

### Requirement: OpenSpec run gating
Plans whose engine is `openspec` SHALL NOT transition to `ready`, `running`, or queued execution unless OpenSpec runtime health is `ready` for the selected project. A missing runtime SHALL produce a visible setup-required state, not a failed agent turn.

#### Scenario: Ready gate blocks missing runtime
- **WHEN** the user tries to validate or mark an OpenSpec plan ready while OpenSpec is missing
- **THEN** the plan remains in its current status and shows a setup-required card linking to Settings → OpenSpec

#### Scenario: Queue launch checks runtime
- **WHEN** the user assigns an OpenSpec-backed plan to a chat
- **THEN** the queue checks runtime health before provisioning a worktree or sending the opening prompt

#### Scenario: Existing projects remain local-first
- **WHEN** OpenSpec health is checked
- **THEN** no prompt text, source code, absolute paths, or secrets are uploaded; checks use local files and configured local commands only

### Requirement: OpenSpec installer auditability
Every OpenSpec install/update/detect action SHALL emit debug logs and local audit entries with action name, selected source, result, version, and sanitized error text. Logs SHALL NOT include secrets, environment variables, prompt text, or full command output unless explicitly expanded from a local diagnostics view.

#### Scenario: Install progress is visible
- **WHEN** an install or update is running
- **THEN** Settings shows a progress row and the debug log shows detect/install/update phases with sanitized status

#### Scenario: Failed install is recoverable
- **WHEN** installation fails
- **THEN** Settings shows the failure reason, retry action, and a manual-install fallback; the app remains usable for non-OpenSpec chat
