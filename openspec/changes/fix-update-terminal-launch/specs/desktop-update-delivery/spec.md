## ADDED Requirements

### Requirement: Signed Update Metadata Availability

Every published desktop release SHALL expose a valid signed Tauri updater manifest at the configured update endpoint before the release is marked public.

#### Scenario: Latest release contains updater metadata
- **WHEN** the configured endpoint `https://github.com/basebuild-net/basebuild/releases/latest/download/latest.json` is fetched after a release is published
- **THEN** the response is HTTP 200 JSON containing `version`, `platforms.windows-x86_64.url`, and `platforms.windows-x86_64.signature`

#### Scenario: Windows installer version matches release
- **WHEN** a release is prepared for version `X.Y.Z`
- **THEN** `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, the release tag, the installer asset name, and the updater manifest version all identify `X.Y.Z`

#### Scenario: Invalid release assets block publication
- **WHEN** the release workflow cannot find `latest.json`, a Windows signature asset, or a Windows installer matching the requested version
- **THEN** the workflow fails before the release is published and reports the missing or mismatched asset

### Requirement: Actionable Update Check Results

The app SHALL distinguish normal no-update states from update-channel configuration or publishing failures.

#### Scenario: Current version has no newer valid release
- **WHEN** the app checks for updates and the signed updater manifest is valid but does not contain a newer version
- **THEN** the update state is `up_to_date` and no update error badge is shown

#### Scenario: Update endpoint is unavailable or malformed
- **WHEN** the updater cannot fetch or parse a valid signed manifest from the configured endpoint
- **THEN** the app shows an actionable diagnostic that identifies the update channel as unavailable or misconfigured and includes enough detail for maintainers to fix the release assets

#### Scenario: Manual check preserves diagnostics
- **WHEN** the user clicks "Check for updates" after an automatic check failed
- **THEN** the settings panel shows the latest checked time, endpoint failure class, and raw updater error message without crashing or hiding the rest of settings

### Requirement: Release Pipeline Regression Coverage

The release and updater code SHALL have tests or workflow checks that cover the observed missing-manifest regression.

#### Scenario: Missing latest JSON is tested
- **WHEN** updater validation receives a 404, empty response, or non-updater JSON payload
- **THEN** the validation path returns the actionable update-channel diagnostic rather than a generic unclassified failure

#### Scenario: Workflow validates public download URL
- **WHEN** the release workflow creates or updates a draft release
- **THEN** it verifies that the public `latest/download/latest.json` URL resolves and contains the expected Windows platform entry before publication
