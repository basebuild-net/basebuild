## ADDED Requirements

### Requirement: Modular Basebuild Config Packs
The system SHALL support modular Basebuild config packs for prompts, workflows, and related local workflow configuration.

#### Scenario: Use built-in official pack
- **WHEN** the app is installed for the first time
- **THEN** at least one built-in official config pack is available offline
- **AND** users can select it for idea-generation workflows

#### Scenario: Create user config pack
- **WHEN** the user creates a custom idea-generation prompt or workflow configuration
- **THEN** the app stores it as a user-editable config pack with version metadata

### Requirement: Prompt Selection
The system SHALL allow users to choose which prompt/config pack powers idea generation and related workflows.

#### Scenario: Select idea-generation prompt
- **WHEN** the user starts idea generation
- **THEN** the UI lets the user choose from built-in official prompts, user-created prompts, and installed prompts

### Requirement: Manual Config Updates
The system SHALL support config-pack update detection and manual installation without silent auto-update.

#### Scenario: Config update available
- **WHEN** a newer version of an installed config pack is detected
- **THEN** the Updates & Requirements UI shows an update card for that pack
- **AND** the user must explicitly choose to review or install the update

#### Scenario: Preserve user changes
- **WHEN** an official or installed pack has a newer version
- **THEN** the app does not overwrite user-created or forked prompts silently

### Requirement: Future D1 Catalog Compatibility
The system SHALL model config-pack sources so a future basebuild.net D1 catalog can provide official and community packs.

#### Scenario: Register remote catalog source
- **WHEN** a D1-backed catalog endpoint is configured in a future integration
- **THEN** the app can represent it as a pack source without changing local pack storage semantics
