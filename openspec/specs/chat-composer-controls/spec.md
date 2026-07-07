# chat-composer-controls Specification

<!-- Merges: MODIFIED from 'parallel-plan-workspaces' (archived 2026-07-06). -->

## Requirements

### Requirement: Compact Chat Control Rail
The chat workspace SHALL render provider, model, effort, connection, and model-refresh controls as a compact single-line rail above the composer input, without wrapping at normal desktop widths. The rail is rendered per chat column (inside the chat header) so each chat in a multi-chat grid has its own independent controls. The rail's layout and control set are ported from the reference IDE's chat composer, adapted to basebuild's `globals.css`-only stack (0px radius, no third-party UI-primitive dependency, no CSS modules).

#### Scenario: Controls fit on one line
- **WHEN** a chat column is open in the default desktop shell layout
- **THEN** the provider status, model selector, effort selector, connect/disconnect action, refresh action, and secondary action entry point render on a single line above the textarea inside that column's header

#### Scenario: Narrow widths degrade predictably
- **WHEN** a chat column becomes too narrow to show every label (e.g. in a `1×4` grid on a narrow viewport)
- **THEN** labels truncate before controls wrap, icon-only buttons retain `title` tooltips, and any overflow actions move into a square overflow menu instead of creating a second controls row

#### Scenario: Current model remains visible
- **WHEN** a provider has multiple selectable models
- **THEN** the selected model remains visible next to the effort selector in the column's header rail, using a compact label and full model id in a tooltip

#### Scenario: Setup state is discoverable
- **WHEN** the selected provider is not connected
- **THEN** the rail shows a setup-required state and a visible connect action without hiding the model and effort controls

#### Scenario: Design contract is preserved
- **WHEN** the compact rail, menus, and pickers render
- **THEN** they use `src/styles/globals.css`, 0px radius, Basebuild Mono colors, and tooltips on every interactive element

#### Scenario: Per-chat independence
- **WHEN** two chat columns are open in a `1×2` grid with different providers selected
- **THEN** each column's rail shows its own provider, model, and effort state; changing one column's model does not change the other's
