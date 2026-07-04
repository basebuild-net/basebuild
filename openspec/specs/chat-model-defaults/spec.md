# chat-model-defaults Specification

## Requirements
### Requirement: Persistent model defaults
The system SHALL persist the last-used provider, model, and effort per project, plus a global default, in local settings. New chat sessions SHALL initialize from the project default, falling back to the global default, then to the first available connected provider/model. Manual selection in the composer SHALL update the project default.

#### Scenario: Model survives restarts
- **WHEN** the user picks `umans/glm-5.2` in a project's chat and restarts the app
- **THEN** the next chat session in that project starts with `umans/glm-5.2` preselected, with no manual re-picking

#### Scenario: New project falls back to global default
- **WHEN** the user opens a project with no stored default
- **THEN** the composer initializes from the global default model if its provider is connected, otherwise the first connected provider's default model

#### Scenario: Unavailable default degrades gracefully
- **WHEN** the stored default's provider is disconnected or the model is missing from the catalog
- **THEN** the composer falls back to the next available option and shows a notice naming the unavailable default, without blocking sending
