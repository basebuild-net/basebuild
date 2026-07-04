## ADDED Requirements

### Requirement: Persistent Runtime Defaults
The system SHALL persist local defaults for terminal and chat runtime behavior without uploading them to any remote service.

#### Scenario: Default terminal command
- **WHEN** the user sets a default terminal command in settings
- **THEN** new terminal tabs use that command unless a workflow explicitly requests another terminal profile

#### Scenario: Default chat adapter
- **WHEN** the user sets a default chat adapter in settings
- **THEN** new chat tabs use that adapter and existing running chats continue using the adapter they were started with

#### Scenario: Default model
- **WHEN** the selected adapter supports model selection and the user sets a default model
- **THEN** new chat requests include that model selection through the adapter contract

#### Scenario: Local persistence
- **WHEN** the app restarts
- **THEN** runtime defaults are restored from local Basebuild state storage

### Requirement: Permission Gates
The system SHALL require explicit permission for agent actions that can run commands, access file context beyond the active project, modify files, or send generated prompts automatically.

#### Scenario: Command permission required
- **WHEN** an adapter requests permission to execute a command outside the already-visible chat/terminal process
- **THEN** the system asks the user unless a matching allow rule already exists

#### Scenario: External file context permission required
- **WHEN** a workflow asks the agent to read context outside the active project root
- **THEN** the system asks the user and records the decision according to the selected persistence scope

#### Scenario: Auto-send disabled by default
- **WHEN** the app is installed or settings are reset
- **THEN** generated prompts are inserted as drafts and are not automatically sent

#### Scenario: Permission denial
- **WHEN** the user denies an agent action
- **THEN** the action is not performed, the chat shows a denial notice, and the workflow remains recoverable

### Requirement: Runtime Profile Registry
The system SHALL model agent and terminal integrations as runtime profiles rather than hardcoded UI branches.

#### Scenario: OMP profile exists
- **WHEN** settings are opened on a fresh install
- **THEN** an OMP chat profile is present and selected by default

#### Scenario: Basebuild CLI profile slot exists
- **WHEN** runtime profiles are listed
- **THEN** a Basebuild CLI profile can be represented as a selectable profile once its executable is available, without changing the chat component contract

#### Scenario: Profile validation
- **WHEN** a runtime profile references a missing executable or invalid command
- **THEN** settings show the validation error and chat startup returns a typed adapter-unavailable error
