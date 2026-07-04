# portable-instant-updates Specification

## Requirements

### Requirement: Portable Windows Release Artifact

Every Windows release SHALL include a portable update-compatible artifact in addition to the installer artifact.

#### Scenario: Release contains portable executable or package
- **WHEN** the Windows release workflow publishes version `X.Y.Z`
- **THEN** the release assets include a clearly named portable artifact for `X.Y.Z` and signed update metadata that points portable clients at the portable-compatible payload

#### Scenario: Portable artifact version matches manifest
- **WHEN** release validation inspects the portable artifact and updater manifest
- **THEN** the portable artifact name, embedded app version, manifest version, and signature all identify the same `X.Y.Z` version

### Requirement: No-Wizard Instant Update Flow

Basebuild SHALL update portable Windows builds without requiring the user to run the setup `.exe` wizard.

#### Scenario: Portable update starts from splash
- **WHEN** a portable build starts and accepts or requires an available update
- **THEN** Basebuild starts an update flow that downloads, verifies, applies, and restarts into the new version without showing the NSIS installer wizard

#### Scenario: Installed update avoids setup wizard when possible
- **WHEN** an installed build supports a no-wizard updater payload for the target release
- **THEN** Basebuild applies the update through the fast updater flow rather than asking the user to manually run a setup `.exe`

#### Scenario: Update progress is visible
- **WHEN** an update is downloading or applying
- **THEN** the startup splash or updater helper shows progress, current step text, target version, and enough install detail to explain what is happening

### Requirement: Safe Self-Replacement Handoff

Basebuild SHALL use a safe handoff mechanism when the running executable cannot replace itself directly.

#### Scenario: Helper applies update after app exit
- **WHEN** the update payload is verified and the running executable or app directory must be replaced
- **THEN** Basebuild launches a trusted updater helper or equivalent handoff, exits the old process, applies the replacement, and restarts the new app

#### Scenario: Failed apply rolls back or preserves old build
- **WHEN** the updater helper cannot replace the app or validate the new executable
- **THEN** it leaves the previous working build launchable, reports the failure, and does not delete the only runnable copy

#### Scenario: Restart opens the updated app
- **WHEN** the updater helper successfully applies version `X.Y.Z`
- **THEN** it launches Basebuild `X.Y.Z` and removes temporary update files that are no longer needed

### Requirement: Signed And Private Update Downloads

The instant update flow SHALL verify update integrity and avoid uploading local data.

#### Scenario: Payload verification blocks tampering
- **WHEN** a downloaded portable or instant-update payload has a missing, invalid, or mismatched signature
- **THEN** Basebuild refuses to apply it and reports the signature failure

#### Scenario: Update requests do not upload local workspace data
- **WHEN** Basebuild checks for or downloads an update
- **THEN** the request is limited to the configured release endpoint and does not upload project paths, prompt content, terminal output, secrets, or analytics data
