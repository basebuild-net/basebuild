## ADDED Requirements

### Requirement: OMP Connector Without OMP Modification
The system SHALL support OMP as a first-class connector without requiring changes to OMP itself.

#### Scenario: OMP detected
- **WHEN** Basebuild scans runtime profiles or connector availability
- **THEN** it can detect the installed OMP executable/version and register an OMP connector entry using local configuration

#### Scenario: OMP not installed
- **WHEN** OMP is not installed or cannot be started
- **THEN** the OMP connector shows an actionable unavailable state and Basebuild does not crash or remove other connectors

#### Scenario: OMP launched by user
- **WHEN** the user starts an OMP connector session
- **THEN** Basebuild launches OMP in the selected project context using the existing no-silent-side-effects policy and records the connector session lifecycle

### Requirement: OMP Raw Terminal Toggle
The system SHALL let users view and control the raw OMP terminal for an OMP connector session while also supporting Basebuild-native projections where available.

#### Scenario: Show raw OMP terminal
- **WHEN** the user toggles an OMP session to raw terminal view
- **THEN** Basebuild displays the OMP PTY output/input with clear labeling that the user is interacting with OMP directly

#### Scenario: Return to native projection
- **WHEN** the user toggles back to native projection
- **THEN** Basebuild returns to the structured chat/session view without launching a second OMP process

#### Scenario: OMP terminal action visible
- **WHEN** OMP asks for input or displays tool output in the raw terminal
- **THEN** Basebuild does not suppress that output from the raw view

### Requirement: OMP Capability Sync
The OMP connector SHALL sync OMP capabilities into Basebuild only when those capabilities are observable through stable local behavior or explicit connector support.

#### Scenario: OMP provider claim discovered
- **WHEN** OMP exposes or implies a provider login/subscription through a stable supported mechanism
- **THEN** Basebuild routes the provider claim through the permission-provider broker before adding it to provider UI

#### Scenario: OMP skills discovered
- **WHEN** OMP reports available skills through a supported command or local metadata
- **THEN** Basebuild displays those skills with OMP attribution and marks them unavailable if OMP later disconnects

#### Scenario: OMP chat sync unsupported
- **WHEN** OMP does not expose structured chat/session data for a running session
- **THEN** Basebuild keeps raw terminal support active and clearly marks native projection fields as unsupported rather than fabricating state

### Requirement: OMP Ownership Boundary
The system SHALL keep OMP-owned auth, provider credentials, terminal behavior, config, and updates under OMP ownership unless the user explicitly promotes or configures Basebuild-owned equivalents.

#### Scenario: OMP owns provider credential
- **WHEN** a provider is added from an OMP claim
- **THEN** Basebuild records OMP as the credential owner and does not copy secrets into Basebuild storage unless the user separately enters Basebuild-owned credentials

#### Scenario: OMP config changes externally
- **WHEN** OMP configuration changes outside Basebuild
- **THEN** Basebuild refreshes connector capability/provider state on next detection or session start and shows changed state without overwriting OMP config

#### Scenario: User disables OMP connector
- **WHEN** the user disables the OMP connector
- **THEN** Basebuild stops OMP connector sync and launch actions but does not uninstall OMP, edit OMP config, or delete OMP-owned credentials
