## MODIFIED Requirements

### Requirement: Chat Controls And Rich Rendering
The chat workspace SHALL provide an always-visible composer that cannot be clipped, with visible model/provider/effort controls, a discoverable empty state, inline adapter-health/setup affordances, markdown/code rendering, and recoverable error states while following the Basebuild design contract.

#### Scenario: Composer is always visible
- **WHEN** a chat tab is open at any window size, including when the message list is empty or overflowing
- **THEN** the message list absorbs all overflow and the composer (model/provider/effort controls, text input, and send control) remains fully visible and interactive at the bottom of the panel, never pushed outside a clipped region

#### Scenario: Model and provider controls are discoverable
- **WHEN** the user looks at an open chat tab
- **THEN** the provider selector, model selector, and effort selector are visible in the composer without scrolling, hovering, or opening a menu, and each control has a tooltip describing its purpose

#### Scenario: Empty state guides first action
- **WHEN** a chat has no messages
- **THEN** the empty state names the active provider/model and points to the composer input and the "Connect provider" action so the user knows exactly where to type and how to enable a model

#### Scenario: Model changed before send
- **WHEN** the user selects a different model before sending a native chat prompt
- **THEN** the outgoing turn records the chosen model and subsequent assistant output is associated with that model

#### Scenario: Active adapter degraded
- **WHEN** the active chat adapter reports unavailable or setup-required health
- **THEN** the composer shows an inline health indicator and a "Set up" / "Connect" action instead of allowing a send that silently fails

#### Scenario: Rich content renders safely
- **WHEN** an assistant response includes markdown, code blocks, lists, links, or structured tool summaries
- **THEN** the chat renders readable content without executing embedded scripts or breaking the global stylesheet/design rules
