## MODIFIED Requirements

### Requirement: Generate Plans with File Context
The system SHALL allow selecting a file as context for plan generation, in addition to the project schematic.

#### Scenario: Select context file
- **WHEN** the user clicks "Select context file" in the generate plan modal
- **THEN** a native file picker opens, and the selected file's content is read and included as context for the plan generation prompt

#### Scenario: File validation
- **WHEN** the user selects a file larger than 50KB
- **THEN** a warning is shown that the file is large and may exceed context limits

#### Scenario: No context available
- **WHEN** the user tries to generate plans without a project schematic or selected context file
- **THEN** a validation warning is shown prompting the user to add context

### Requirement: Plan CRUD
The system SHALL persist plans and reflect changes immediately in the side panel.

#### Scenario: Create a plan
- **WHEN** the user clicks the create plan button in the Plans section
- **THEN** a new draft plan is created and appears in the "Draft" lane immediately

#### Scenario: Edit a plan
- **WHEN** the user edits a plan via the edit modal and saves
- **THEN** the plan card updates with the new title, description, and goal

#### Scenario: Change plan status
- **WHEN** the user changes a plan's status via the focus modal or card menu
- **THEN** the plan moves to the corresponding status lane in the panel

#### Scenario: Delete a plan
- **WHEN** the user clicks delete on a plan card
- **THEN** the plan is removed from the database and the panel updates immediately
