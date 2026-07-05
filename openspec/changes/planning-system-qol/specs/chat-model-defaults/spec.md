## ADDED Requirements

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
