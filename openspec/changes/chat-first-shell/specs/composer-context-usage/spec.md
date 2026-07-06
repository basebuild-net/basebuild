# composer-context-usage Specification (delta)

## ADDED Requirements

### Requirement: Context size and usage readout
The chat composer SHALL display a compact readout of the active model's context
window size and the current context usage (tokens used versus the window limit)
for the active chat. The readout SHALL sit alongside the model and effort
controls, carry a `title` tooltip with the exact figures, and use `mono`
numerals per the design contract.

#### Scenario: Readout reflects the active model
- **WHEN** a model with a known context window is selected
- **THEN** the readout shows that window size and the current usage for the
  active chat

#### Scenario: Usage updates with the conversation
- **WHEN** the conversation grows or is compacted
- **THEN** the usage figure updates to reflect the current context consumption

#### Scenario: Unknown window degrades gracefully
- **WHEN** the active model's context window size is unknown
- **THEN** the readout shows usage without a fabricated limit and does not error
