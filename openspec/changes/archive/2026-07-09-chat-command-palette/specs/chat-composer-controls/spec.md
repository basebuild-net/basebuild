# chat-composer-controls Specification (delta)

## ADDED Requirements

### Requirement: Commands Button Entry Point
The chat composer controls SHALL include a visible `Commands` button that opens the slash command palette without requiring the user to type `/`. The button SHALL insert the selected command into the composer for review/editing rather than executing it immediately, preserving keyboard-first and pointer-first parity.

#### Scenario: Commands button opens palette
- **WHEN** the user activates the `Commands` button beside the composer
- **THEN** the same command palette used for slash autocomplete opens with the full command list, descriptions, usage hints, and recent-command ordering

#### Scenario: Button selection fills composer
- **WHEN** the user selects `/model` from the Commands button palette
- **THEN** the composer draft becomes `/model ` with the helper text visible and the command is not executed until the user submits it

#### Scenario: Button respects command filtering
- **WHEN** the Commands button palette is open and the user types a filter
- **THEN** the list filters identically to typing after `/` in the composer and keeps ArrowUp/ArrowDown, Tab, Enter, and Escape behavior consistent

#### Scenario: Design contract is preserved
- **WHEN** the Commands button and palette render
- **THEN** they use `src/styles/globals.css`, 0px radius, Basebuild Mono colors, a square/flat visual language, and `title=` tooltips on every interactive element
