## ADDED Requirements

### Requirement: Chat Slash Commands
The chat composer SHALL treat recognized slash commands as local UI commands instead of provider prompts.

#### Scenario: Login command
- **WHEN** the user types `/login` and confirms it
- **THEN** Basebuild opens a provider chooser/connection UI where the user can select a provider and start web login or API-key entry

#### Scenario: Login command with provider
- **WHEN** the user types `/login anthropic` or another supported provider id/label
- **THEN** Basebuild opens the connection UI preselected to that provider when it can resolve the provider name

#### Scenario: Model command
- **WHEN** the user types `/model`
- **THEN** Basebuild opens a searchable model picker populated from the current provider/model catalog

#### Scenario: Model command with filter
- **WHEN** the user types `/model sonnet` or another model/provider substring
- **THEN** the model picker filters to matching providers, model ids, and model labels without sending the command text to the model provider

#### Scenario: Refresh models command
- **WHEN** the user types `/models refresh`
- **THEN** Basebuild forces model catalog refresh and reports success or failure inline in the chat UI

#### Scenario: Unknown slash command
- **WHEN** the user types an unrecognized slash command
- **THEN** Basebuild shows a local command error/help state and does not send the slash command to the selected provider unless the user explicitly chooses to send it as plain text

#### Scenario: Keyboard and pointer parity
- **WHEN** a slash command opens provider or model UI
- **THEN** the same UI is also reachable through visible controls near the effort selector, and every command action is keyboard accessible
