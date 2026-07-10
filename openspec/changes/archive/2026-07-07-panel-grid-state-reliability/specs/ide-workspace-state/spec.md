## MODIFIED Requirements

### Requirement: Persistent Panel Grid Layout
The system SHALL persist and restore a normalized panel-grid layout independently per project. A restored tree SHALL contain structurally valid split nodes, unique reachable panel ids, valid size vectors, and an `activePanelId` that identifies a live leaf or is `null` for an empty tree. Recoverable corruption SHALL be repaired deterministically and written back only to the project that owned the loaded state. Project switching SHALL prevent late restore or debounced-save work from one project from hydrating or overwriting another project's grid.

#### Scenario: Stale active id is normalized
- **GIVEN** a stored grid has live panels but `activePanelId` references no live leaf
- **WHEN** the project is restored
- **THEN** the system selects a deterministic live panel, keeps the remaining valid layout, records a repair diagnostic, and persists the repaired state for that project

#### Scenario: Late restore cannot cross projects
- **WHEN** project A's restore resolves after the user has selected project B
- **THEN** project A's response is ignored for the visible grid and cannot be persisted under project B

#### Scenario: Debounced save retains project ownership
- **WHEN** project A has a pending layout save and the user switches to project B
- **THEN** the save is cancelled or flushed against project A, and project B's stored layout is not overwritten by A's state

#### Scenario: Duplicate or malformed entries are recoverable
- **WHEN** a stored grid contains malformed nodes, invalid sizes, or duplicate ids across live and closed panels
- **THEN** the valid reachable layout remains usable, unsafe entries are quarantined or reported, and backing sessions are not silently deleted

### Requirement: Project transition interaction boundary
The shell SHALL treat project selection, restore, and grid ownership as one transition. Panel-mutating actions SHALL remain disabled until the selected project's restore state is ready, and each user selection SHALL perform project detection and emit selection diagnostics once.

#### Scenario: Creation during project restore
- **WHEN** the user switches projects while restore is still loading
- **THEN** panel creation is temporarily disabled with a visible loading state and cannot mutate the previous project's grid

#### Scenario: One selection produces one diagnostic
- **WHEN** the user selects a project once
- **THEN** project detection runs once and one "Project selected" event is recorded

