## MODIFIED Requirements

### Requirement: Composer Rail In Panel Grid
The system SHALL render the compact composer rail (provider/model/effort/connect/refresh + overflow menu) as the footer of a chat panel leaf in the panel grid, not as a separate header above a chat-only grid column. The rail's per-panel independence, truncation, and single-line contract are preserved. Every control has a `title=` tooltip.

#### Scenario: Composer rail visible in a chat panel
- **WHEN** a chat panel is focused in the grid
- **THEN** the composer rail renders at the bottom of the panel leaf with the provider trigger, model trigger, effort select, refresh, and ideas buttons

#### Scenario: Multiple chat panels are independent
- **WHEN** two chat panels are open side by side in the grid
- **THEN** each panel's composer rail operates independently — changing the model in one does not affect the other
