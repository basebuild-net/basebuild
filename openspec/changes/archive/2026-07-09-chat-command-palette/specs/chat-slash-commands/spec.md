# chat-slash-commands Specification (delta)

## MODIFIED Requirements

### Requirement: Chat Slash Commands
The chat composer SHALL treat recognized slash commands as local UI commands instead of provider prompts. Built-in chat commands SHALL include `/login [provider]`, `/model [query]`, `/provider [query]`, `/models refresh`, `/clear`, `/new`, `/commands`, `/help`, and `/stop`, while preserving existing planning, idea, OpenSpec, MCP, and skill commands. Commands that change local state SHALL show inline success/failure feedback in the chat UI and SHALL NOT expose credentials or provider tokens.

#### Scenario: Login command
- **WHEN** the user types `/login` and confirms it
- **THEN** Basebuild opens a provider chooser/connection UI where the user can select a provider and start web login or API-key entry

#### Scenario: Login command with provider
- **WHEN** the user types `/login anthropic` or another supported provider id/label
- **THEN** Basebuild opens the connection UI preselected to that provider when it can resolve the provider name

#### Scenario: Model command
- **WHEN** the user types `/model`
- **THEN** Basebuild opens a searchable model picker populated from the current provider/model catalog without sending the command text to the model provider

#### Scenario: Model command with filter
- **WHEN** the user types `/model sonnet` or another model/provider substring
- **THEN** the model picker filters to matching providers, model ids, and model labels and allows the selected model to become the active chat model

#### Scenario: Provider command
- **WHEN** the user types `/provider`
- **THEN** Basebuild opens a searchable provider picker populated from the local provider catalog, showing connection/setup state for each provider

#### Scenario: Provider command with filter
- **WHEN** the user types `/provider openai` or another provider id/label substring
- **THEN** the provider picker filters to matching providers and allows the selected provider to become the active chat provider with a compatible model fallback

#### Scenario: Refresh models command
- **WHEN** the user types `/models refresh`
- **THEN** Basebuild forces model catalog refresh and reports success or failure inline in the chat UI

#### Scenario: Clear chat command
- **WHEN** the user types `/clear` in a chat with persisted messages
- **THEN** Basebuild asks for explicit confirmation before deleting persisted messages, clears the visible transcript after confirmation, preserves provider/model/effort selection, and reports the result inline

#### Scenario: Clear empty chat command
- **WHEN** the user types `/clear` in a chat with no persisted messages
- **THEN** Basebuild clears the draft and transient transcript state without requiring a destructive confirmation

#### Scenario: New chat command
- **WHEN** the user types `/new`
- **THEN** Basebuild creates or focuses a fresh empty chat for the current project without deleting the previous chat and carries forward the effective provider/model/effort defaults

#### Scenario: Commands command
- **WHEN** the user types `/commands`
- **THEN** Basebuild shows the complete command reference locally with names, descriptions, usage, source labels, and shadowed-command notes

#### Scenario: Help command
- **WHEN** the user types `/help`
- **THEN** Basebuild shows the same command reference as `/commands` plus a short keyboard guide for filtering, ArrowUp/ArrowDown navigation, Tab completion, Enter submission, and Escape dismissal

#### Scenario: Stop command
- **WHEN** the user types `/stop` while the current chat has an active request
- **THEN** Basebuild cancels the active request and reports whether a run was cancelled

#### Scenario: Stop command when idle
- **WHEN** the user types `/stop` while no request is active
- **THEN** Basebuild reports that nothing is running and does not send the command text to the provider

#### Scenario: Unknown slash command
- **WHEN** the user types an unrecognized slash command
- **THEN** Basebuild shows a local command error/help state and does not send the slash command to the selected provider unless the user explicitly chooses to send it as plain text

#### Scenario: Keyboard and pointer parity
- **WHEN** a slash command opens provider, model, command reference, or confirmation UI
- **THEN** the same UI is reachable through visible controls near the composer, every action is keyboard accessible, and every interactive element has a `title=` tooltip
