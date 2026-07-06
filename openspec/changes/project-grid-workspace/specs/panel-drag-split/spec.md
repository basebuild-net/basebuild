## ADDED Requirements

### Requirement: Drag-to-split
The system SHALL let the user drag a panel's header onto another panel to create a VS Code-style split. During the drag, the system SHALL show visual drop zones on the target panel's left, right, top, and bottom edges indicating where the dragged panel will land if dropped. The drop zones SHALL cover approximately half the target panel's area and highlight on hover.

#### Scenario: Drag chat onto terminal — split right
- **WHEN** the user drags a chat panel's header onto the right half of a terminal panel and releases
- **THEN** the terminal panel splits into a `1×2` layout with the terminal on the left and the chat on the right, separated by a splitter

#### Scenario: Drag chat onto terminal — split down
- **WHEN** the user drags a chat panel's header onto the bottom half of a terminal panel and releases
- **THEN** the terminal panel splits into a `2×1` layout with the terminal on top and the chat on the bottom, separated by a horizontal splitter

#### Scenario: Drag to reorder within a row
- **WHEN** the user drags a panel's header onto the left edge of another panel in the same row
- **THEN** the dragged panel moves to the left of the target without creating a new split

#### Scenario: Drag threshold
- **WHEN** the user clicks a panel header and moves less than 4px
- **THEN** no drag starts and the click is treated as a focus action

### Requirement: Visual drop zones
During a panel header drag, the system SHALL render four semi-transparent overlay zones on every other panel: left, right, top, bottom. The zone under the cursor SHALL highlight (color + opacity change) to indicate the split direction. Zones SHALL NOT appear on the dragged panel itself.

#### Scenario: Hover right edge
- **WHEN** the cursor is over the right half of a target panel during a drag
- **THEN** the right zone highlights and a tooltip or label indicates "Split right"

#### Scenario: No drop zone on self
- **WHEN** the cursor is over the dragged panel's own area
- **THEN** no drop zones are rendered and no split is offered

### Requirement: Animated split creation
When a split is committed by a drop, the new panel SHALL animate in (width or height grows from zero to its allocated share) and the dragged panel's content SHALL transfer to the new position without remounting. The split tree SHALL be updated atomically.

#### Scenario: Split creates new panel
- **WHEN** a drag-to-split commits
- **THEN** the target panel's area is divided, the dragged panel moves to the new position, and a new splitter appears between them with a 180ms ease-out transition
