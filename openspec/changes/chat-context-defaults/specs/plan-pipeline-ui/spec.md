## MODIFIED Requirements

### Requirement: Generate From Context Opens Chat
The system SHALL route `Generate plans` → `Generate from context` into the workspace chat instead of silently creating placeholder plans.

#### Scenario: Existing chat tab
- **WHEN** the user selects `Generate from context` and an active-session chat tab exists
- **THEN** the generate modal closes, the existing chat tab is focused, and a generated planning prompt is placed in the chat input

#### Scenario: No chat tab
- **WHEN** the user selects `Generate from context` and no active-session chat tab exists
- **THEN** the generate modal closes, a new chat tab is created, the workspace switches to that tab, and a generated planning prompt is placed in the chat input

#### Scenario: No active project or session
- **WHEN** the user selects `Generate from context` without an active project or active session
- **THEN** the system shows a visible warning explaining that a project/session is required and does not discard the modal input

### Requirement: Context Prompt Composition
The system SHALL compose a transparent prompt from available project planning context before injecting it into chat.

#### Scenario: Schematic exists
- **WHEN** the project has `.basebuild/project-schematic.md`
- **THEN** the generated prompt includes the schematic content, current plan list summary, project path, and a request to propose OpenSpec-backed plans

#### Scenario: Selected file context exists
- **WHEN** the user selected a file or folder context in the generate modal
- **THEN** the generated prompt identifies that context source and includes either file content within size limits or a request for the agent to inspect the selected folder

#### Scenario: Missing context
- **WHEN** no schematic and no selected context are available
- **THEN** the system opens the Project Description flow before generating a chat prompt, preserving the user's modal input

### Requirement: Plan Generation Auditability
The system SHALL keep AI plan generation visible and reversible through chat before persistent plans are created.

#### Scenario: Prompt is visible
- **WHEN** the system prepares a generated-plan request
- **THEN** the exact prompt is visible in the chat input or sent message before any generated plans are persisted

#### Scenario: Agent returns plans
- **WHEN** the agent returns a structured plan proposal
- **THEN** the user can review the response in chat before accepting or manually creating plans from it

#### Scenario: Placeholder path removed
- **WHEN** the chat workflow is available
- **THEN** the system does not create placeholder `generated` plans solely because `Generate from context` was clicked
