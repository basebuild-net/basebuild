# panel-grid Specification

## Requirements

### Requirement: Panel creation
The system SHALL create Chat, Terminal, Schematic, File, and Oh My Pi panels through one checked insertion contract. Creation SHALL resolve a valid live anchor from the current split tree, SHALL make the new panel visible and focused exactly once, and SHALL report an actionable failure when insertion cannot complete. A stale or missing `activePanelId` MUST NOT turn creation into a silent no-op. Resource-backed creation SHALL NOT leave a hidden session tab, terminal, or agent process when visible panel insertion fails.

#### Scenario: Stale active panel id is repaired during creation
- **GIVEN** the grid has at least one live panel but its stored `activePanelId` does not identify a live leaf
- **WHEN** the user creates a Chat, Terminal, Schematic, File, or Oh My Pi panel
- **THEN** the system uses a deterministic live fallback anchor, inserts and focuses exactly one new panel, and repairs the active id

#### Scenario: Empty grid accepts the first panel
- **WHEN** the user creates a panel in an empty grid
- **THEN** the new panel becomes the sole root leaf and receives focus without requiring an anchor id

#### Scenario: Insertion failure has no hidden side effect
- **WHEN** a panel cannot be inserted or bound
- **THEN** the user sees an actionable error, no unreachable session tab or process remains, and the prior grid stays usable

#### Scenario: Rapid repeated creation has unique identity
- **WHEN** panel creation actions occur in the same clock tick or while another creation is pending
- **THEN** every accepted panel has a collision-resistant unique id and each accepted action creates at most one backing resource

### Requirement: Recoverable panel lifecycle
Process-backed panel creation SHALL reserve a visible pending panel before acquiring a terminal or agent process, then atomically bind the resulting identifiers. If acquisition or binding fails, the system SHALL remove the reservation and perform compensating cleanup for any acquired resource.

#### Scenario: Terminal creation succeeds
- **WHEN** the user creates a Terminal panel and the PTY starts successfully
- **THEN** a visible pending panel is reserved first, the PTY is bound to it, the pending state clears, and exactly one terminal is reachable

#### Scenario: Terminal spawn fails
- **WHEN** terminal creation fails after a panel reservation
- **THEN** the reservation is removed, the failure is shown and logged, and no terminal record or process is presented as running

#### Scenario: Bind fails after resource acquisition
- **WHEN** a backend resource starts but cannot be bound to the reserved panel
- **THEN** the system attempts compensating cleanup, reports both outcomes, and exposes any cleanup failure for explicit recovery
