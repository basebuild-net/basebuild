## ADDED Requirements

### Requirement: Compact Chat Control Rail
The chat workspace SHALL render provider, model, effort, connection, and model-refresh controls as a compact single-line rail above the composer input, without wrapping at normal desktop widths.

#### Scenario: Controls fit on one line
- **WHEN** a chat tab is open in the default desktop shell layout
- **THEN** the provider status, model selector, effort selector, connect/disconnect action, refresh action, and secondary action entry point render on a single line above the textarea

#### Scenario: Narrow widths degrade predictably
- **WHEN** the chat panel becomes too narrow to show every label
- **THEN** labels truncate before controls wrap, icon-only buttons retain `title` tooltips, and any overflow actions move into a square overflow menu instead of creating a second controls row

#### Scenario: Current model remains visible
- **WHEN** a provider has multiple selectable models
- **THEN** the selected model remains visible next to the effort selector, using a compact label and full model id in a tooltip

#### Scenario: Setup state is discoverable
- **WHEN** the selected provider is not connected
- **THEN** the rail shows a setup-required state and a visible connect action without hiding the model and effort controls

#### Scenario: Design contract is preserved
- **WHEN** the compact rail, menus, and pickers render
- **THEN** they use `src/styles/globals.css`, 0px radius, Basebuild Mono colors, and tooltips on every interactive element
