# chat-composer-controls Specification (delta)

## MODIFIED Requirements

### Requirement: Compact Chat Control Rail
The chat composer SHALL keep the model and effort controls **always visible** —
they SHALL NOT be moved into an overflow menu at any supported width. The rail
SHALL sit with a tall, auto-growing input and carry, alongside model and effort:
the connection/connect action, the microphone control (`composer-voice-input`),
and the context size + usage readout (`composer-context-usage`). Only genuinely
secondary actions may use slash-command accelerators or a square overflow menu;
the model/effort/mic/usage essentials never hide. The rail SHALL follow the
design contract (`src/styles/globals.css`, 0px radius, Basebuild Mono colors,
tooltips on every interactive element).

#### Scenario: Model and effort always visible
- **WHEN** a chat tab is open at any supported desktop width
- **THEN** the model selector and effort selector remain visible and are never
  collapsed into an overflow menu

#### Scenario: Essentials present on the rail
- **WHEN** the composer renders
- **THEN** model, effort, the microphone control, and the context/usage readout
  are all present on the composer, with the tall growing input below or beside
  them

#### Scenario: Current model remains visible
- **WHEN** a provider has multiple selectable models
- **THEN** the selected model remains visible next to the effort selector, using
  a compact label and full model id in a tooltip

#### Scenario: Setup state is discoverable
- **WHEN** the selected provider is not connected
- **THEN** the rail shows a setup-required state and a visible connect action
  without hiding the model and effort controls

#### Scenario: Design contract is preserved
- **WHEN** the rail, menus, pickers, mic, and usage readout render
- **THEN** they use `src/styles/globals.css`, 0px radius, Basebuild Mono colors,
  and tooltips on every interactive element
