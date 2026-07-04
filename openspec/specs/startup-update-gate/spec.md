# startup-update-gate Specification

## Requirements

### Requirement: Startup Update Splash

Basebuild SHALL show a startup update splash before the main shell becomes interactive during packaged app startup.

#### Scenario: Splash shows current build version while checking
- **WHEN** a packaged Basebuild build starts
- **THEN** the splash shows the current build version and a `Checking for updates` state before presenting the main shell

#### Scenario: No update continues quickly
- **WHEN** the update check completes and the signed update manifest contains no newer version
- **THEN** the splash transitions to the main app without requiring user action

#### Scenario: Update channel diagnostics remain visible
- **WHEN** the startup update check fails because the update endpoint is unreachable, malformed, missing a platform entry, or signature-invalid
- **THEN** the splash shows an actionable diagnostic and offers a retry path without crashing the app

### Requirement: Optional Update Prompt

Basebuild SHALL present optional updates with explicit user choice when the running version remains supported.

#### Scenario: Optional update offers upgrade and skip
- **WHEN** the startup check finds a newer signed release and the running version is not below the release channel's minimum supported version
- **THEN** the splash shows the target version, release notes or summary when available, an `Upgrade` action, and a `Skip version` or `Skip update for now` action

#### Scenario: Optional skip reaches the app
- **WHEN** the user skips an optional update from the splash
- **THEN** Basebuild opens the main app and keeps the in-app Updates UI available for later manual update checks or installation

#### Scenario: Skipping is version-scoped
- **WHEN** the user skips an optional update for version `X.Y.Z`
- **THEN** Basebuild suppresses the startup prompt for `X.Y.Z` according to the configured skip policy but prompts again for a newer target version or a mandatory update

### Requirement: Mandatory Update Policy

Basebuild SHALL support release-channel policy that marks old client versions as unsupported and removes the skip path.

#### Scenario: Unsupported current version auto-starts update
- **WHEN** the update manifest declares a minimum supported version of `0.1.2` and the running app is version `0.0.3`
- **THEN** the splash hides the skip action and starts the update flow automatically after showing the mandatory update state

#### Scenario: Mandatory update explains why skip is unavailable
- **WHEN** the running version is below the configured minimum supported version
- **THEN** the splash states that this build is no longer supported and identifies the minimum supported version or required target version

#### Scenario: Mandatory update failure is recoverable
- **WHEN** a mandatory update download, verification, apply, or restart step fails
- **THEN** the splash shows the failed step, preserves the current app when possible, and offers retry plus a safe exit path rather than opening an unsupported build silently

### Requirement: Existing In-App Update UI Remains Available

The startup splash SHALL complement, not replace, the existing in-app update controls.

#### Scenario: Settings updates tab remains functional
- **WHEN** the user opens Settings after startup
- **THEN** the Updates tab can check for updates, show current update diagnostics, and start available updates using the same release metadata and policy evaluation

#### Scenario: Taskbar update affordance remains functional
- **WHEN** a supported user skips an optional startup update or a newer update appears while the app is running
- **THEN** the taskbar update button can still show availability and start the update flow
