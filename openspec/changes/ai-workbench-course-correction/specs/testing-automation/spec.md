# testing-automation Specification

## MODIFIED Requirements

### Requirement: MVP journey and compact visual coverage
The system SHALL gate the AI workbench workflow with deterministic tests and
live screenshots at 960x640 and 1280x800. Coverage SHALL include exact command
strip routing, no manual plan creation, side-by-side Settings, compact context,
connected-first provider ordering, provider-scoped models, session restoration,
visible tool/question activity, and non-blank modal loading/error states.

#### Scenario: Course-correction suite runs
- **WHEN** CI or a release candidate runs the MVP workbench gate
- **THEN** any wrong destination, blank modal, overflowing required control,
  false tools capability, hidden activity, or manual plan creation fails the gate

### Requirement: Responsiveness and diagnostic-noise budgets
The system SHALL measure project-loading first paint, modal first paint,
provider/model restoration, and first activity feedback. Common UI feedback
SHALL begin within 100ms, slow operations SHALL remain off the renderer thread,
and every entry, abort, retry, and state transition SHALL emit debug context
without expected transitions becoming warnings.

#### Scenario: User opens Ideas during catalog refresh
- **WHEN** a provider catalog refresh is running and the user opens Ideas
- **THEN** the modal frame and loading/empty content respond immediately, remain
  interactive, and produce no freeze report or unrelated warning spam

