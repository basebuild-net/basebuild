## MODIFIED Requirements

### Requirement: Compact Chat Control Rail
The chat workspace SHALL render runtime/engine, provider, model, effort, connection, model-refresh, idea-generation, OpenSpec assignment, context-usage, and loading-state controls as a compact rail around the composer input without hiding model/effort at normal desktop widths. The rail is rendered per chat column so each chat in a multi-chat grid has independent runtime/model/context state. The rail SHALL use flat spacing, larger primary add/send affordances where useful, `…` menus for secondary actions, CSS variables, 0px radius, and no product-code comments naming external reference apps.

#### Scenario: Controls fit on one line
- **WHEN** a chat column is open in the default desktop shell layout
- **THEN** provider/model/effort, connection state, context meter, and primary send/action controls render without wrapping over the input

#### Scenario: Narrow widths degrade predictably
- **WHEN** a chat column becomes too narrow to show every label
- **THEN** labels truncate before controls wrap, icon-only buttons retain `title` tooltips, and secondary actions move into a square `…` menu instead of creating a second controls row

#### Scenario: Current model remains visible
- **WHEN** a provider has multiple selectable models
- **THEN** the selected model remains visible next to the effort selector with full model id in a tooltip

#### Scenario: Setup state is discoverable
- **WHEN** the selected provider or OpenSpec runtime is not configured
- **THEN** the rail shows a setup-required state and a visible connect/install action without hiding model, effort, or the drafted message

#### Scenario: Per-chat independence
- **WHEN** two chat columns are open in a `1×2` grid with different providers selected
- **THEN** each column's rail shows its own provider, model, effort, context usage, plan assignment, and queue state; changing one column does not change the other's controls

#### Scenario: Zoom indicator remains visible
- **WHEN** the user changes app zoom
- **THEN** a compact zoom indicator updates in the status/bottom-right area without displacing the composer controls
