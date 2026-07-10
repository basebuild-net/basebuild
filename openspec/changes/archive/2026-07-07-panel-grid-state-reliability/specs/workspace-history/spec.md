## MODIFIED Requirements

### Requirement: Re-open from history
Re-opening a panel from history SHALL use a valid live insertion anchor or become the sole root panel when the grid is empty. The operation SHALL remove the panel from history only after insertion succeeds. A stale `activePanelId` SHALL be repaired or replaced by a deterministic live fallback and MUST NOT cause a silent no-op or loss of the history entry.

#### Scenario: Re-open with stale active id
- **GIVEN** a closed panel is present in history and the current `activePanelId` is not a live leaf
- **WHEN** the user re-opens the panel
- **THEN** the panel is inserted beside a deterministic live panel, receives focus, and is removed from history exactly once

#### Scenario: Failed re-open preserves history
- **WHEN** a history panel cannot be inserted
- **THEN** the history entry remains available, the existing grid is unchanged, and the user sees an actionable error

### Requirement: Legacy orphan recovery
The system SHALL detect backing session tabs that are not reachable from the normalized visible grid and expose a non-destructive recovery path. It SHALL NOT permanently delete an orphaned tab or session without an explicit confirm-gated user action.

#### Scenario: Orphaned tab discovered
- **WHEN** normalization finds a backing tab with no reachable visible or history panel
- **THEN** the app reports the orphan and offers to recover it into history or the grid without deleting its data

#### Scenario: Permanent cleanup requires confirmation
- **WHEN** the user chooses to permanently remove an orphaned tab
- **THEN** a confirm dialog identifies the local data to be deleted before any deletion occurs

