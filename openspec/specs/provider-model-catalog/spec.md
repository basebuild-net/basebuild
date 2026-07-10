# provider-model-catalog Specification

## Requirements

### Requirement: Multi-Provider Connection State
The system SHALL show connected/authenticated providers before available
providers, preserve every connection, and restore the active chat session's
provider/model/effort before falling back to project defaults. Provider and
model controls SHALL explain connection and capability state without exposing
credentials.

#### Scenario: Existing chat is reopened
- **WHEN** the user restarts Basebuild and reopens a chat that used a connected
  provider and model
- **THEN** that provider/model/effort are selected before the composer paints
  and connected providers appear first in the picker

#### Scenario: User scans provider connection state
- **WHEN** the provider/model modal opens with connected and unconnected providers
- **THEN** connected providers appear first with a green rail/dot and Connected
  label, available providers use grey styling and an Available label, every card
  shows model count, and selected state remains distinct from connection state
### Requirement: Automatic Model Catalog Sync
The system SHALL scope model choices to the selected provider and derive
planning, tools, reasoning, context, and effort support from the effective
catalog transport capability. A model whose transport cannot expose tools SHALL
NOT be offered as planning-compatible even if its upstream model family can use
tools through a different transport.

#### Scenario: Bespoke provider transport lacks tool events
- **WHEN** the selected provider/model uses a transport that does not expose the
  native tool loop
- **THEN** planning actions are disabled with an actionable reason and the UI
  does not start a run that stalls after a prose gathering message

#### Scenario: User changes provider
- **WHEN** the user selects a different provider
- **THEN** the model picker contains only that provider's models and selects a
  compatible visible fallback without borrowing an id from another provider
