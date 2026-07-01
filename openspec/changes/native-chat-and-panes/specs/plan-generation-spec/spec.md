## ADDED Requirements

### Requirement: Three-Mode Plan Generation
The system SHALL provide a plan generation modal with three distinct modes: AI expand from description, existing schema import, and auto-generation from project context.

#### Scenario: User chooses AI expand
- **WHEN** the user selects "Describe & expand" mode and enters a goal description
- **THEN** the system uses AI to expand the description into a full project schema and generates plans

#### Scenario: User chooses existing schema
- **WHEN** the user selects "Existing schema" mode and picks a file or folder
- **THEN** the system reads the schema and generates plans based on it

#### Scenario: User chooses from context
- **WHEN** the user selects "From project context" mode
- **THEN** the system generates plans based on the current project's files, structure, and existing configuration

### Requirement: File and Folder Context Picker
The system SHALL support selecting both files and folders as context for plan generation.

#### Scenario: User selects a file
- **WHEN** the user clicks "Select file" in the existing schema mode
- **THEN** a file picker dialog opens allowing selection of .md, .json, .yaml, .yml, .toml, .txt files

#### Scenario: User selects a folder
- **WHEN** the user clicks "Select folder" in the existing schema mode
- **THEN** a folder picker dialog opens and the selected folder path is used as context

### Requirement: Idea-to-Plan Pipeline
The system SHALL provide a pipeline that generates ideas, lets the user select them, and then generates OpenSpec plans from the selected ideas.

#### Scenario: User generates ideas
- **WHEN** the user clicks "Generate ideas" and selects a model
- **THEN** the system uses OMP with the selected model to generate idea categories and suggestions

#### Scenario: User picks ideas
- **WHEN** the user selects one or more ideas from the generated suggestions
- **THEN** the UI updates with pending tasks based on the selected ideas

#### Scenario: User generates an OpenSpec plan
- **WHEN** the user clicks "Generate OpenSpec" and selects a model
- **THEN** the system uses OMP to create an OpenSpec plan from the selected idea, and the UI shows the plan generation status

#### Scenario: User queues or runs a plan
- **WHEN** a plan is generated
- **THEN** the user can enable an "Autorun" checkbox with a model selector, add to queue, or run immediately

### Requirement: Model Selection for Plan Generation
The system SHALL allow the user to choose which AI model to use at each stage of the plan generation pipeline.

#### Scenario: Model selection for ideas
- **WHEN** the user clicks "Generate ideas"
- **THEN** a model selector appears showing available OMP models, with the current default pre-selected

#### Scenario: Model selection for plan generation
- **WHEN** the user clicks "Generate OpenSpec"
- **THEN** a model selector appears with a recommendation to use a higher-intelligence model
