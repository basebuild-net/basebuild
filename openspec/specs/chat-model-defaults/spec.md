# chat-model-defaults Specification

<!-- Merges: MODIFIED from 'parallel-plan-workspaces' (archived 2026-07-06). -->

## Requirements
### Requirement: Persistent model defaults
The system SHALL persist the last-used provider, model, and effort per project, plus a global default, in local settings. New chat sessions SHALL initialize from the project default, falling back to the global default, then to the first available connected provider/model. Manual selection in a chat column's header rail SHALL update the project default. Each chat column in a multi-chat grid tracks its own active provider/model/effort but the project default follows the most recently changed column.

#### Scenario: Model survives restarts
- **WHEN** the user picks `umans/glm-5.2` in a project's chat and restarts the app
- **THEN** the next chat session in that project starts with `umans/glm-5.2` preselected, with no manual re-picking

#### Scenario: New project falls back to global default
- **WHEN** the user opens a project with no stored default
- **THEN** the chat column's header rail initializes from the global default model if its provider is connected, otherwise the first connected provider's default model

#### Scenario: Unavailable default degrades gracefully
- **WHEN** the stored default's provider is disconnected or the model is missing from the catalog
- **THEN** the chat column's header rail falls back to the next available option and shows a notice naming the unavailable default, without blocking sending

#### Scenario: Per-column selection updates project default
- **WHEN** the user changes the model in one of two open chat columns in a `1×2` grid
- **THEN** the changed column uses the new model, the unchanged column keeps its own selection, and the project default is updated to the new model so that new chat columns thereafter start with it

### Requirement: Effort level validity
The chat column header rail SHALL only offer effort levels present in the selected model's `supportedEfforts`, and persisted defaults SHALL be clamped to a supported level (nearest supported, preferring the model's default) when restored or when the model changes. Requests MUST NOT be sent with an effort the catalog marks unsupported for the model.

#### Scenario: Switching to a restricted-effort model
- **WHEN** a chat column is on `medium` and the user selects `umans/umans-glm-5.2` (supported: `high`, `xhigh`)
- **THEN** the effort selector in that column clamps to a supported value and the persisted project default stores that clamped value, not `medium`

#### Scenario: Restoring a stale effort default
- **WHEN** a stored project default contains an effort the model no longer supports
- **THEN** each restored chat column initializes with a supported effort and shows the clamped value without blocking sending
