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

### Requirement: Effort level validity
The composer SHALL only offer effort levels present in the selected model's
`supportedEfforts`, and persisted defaults SHALL be clamped to a supported
level (nearest supported, preferring the model's default) when restored or
when the model changes. Requests MUST NOT be sent with an effort the catalog
marks unsupported for the model.

#### Scenario: Switching to a restricted-effort model
- **WHEN** the composer is on `medium` and the user selects
  `umans/umans-glm-5.2` (supported: `high`, `xhigh`)
- **THEN** the effort selector clamps to a supported value and the persisted
  project default stores that clamped value, not `medium`

#### Scenario: Restoring a stale effort default
- **WHEN** a stored project default contains an effort the model no longer
  supports
- **THEN** the composer initializes with a supported effort and shows the
  clamped value without blocking sending
