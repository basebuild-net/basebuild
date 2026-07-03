## MODIFIED Requirements

### Requirement: Health-Aware Default Adapter Selection
The system SHALL choose the default chat adapter from currently-available adapters and SHALL NOT persist or activate an adapter that reports unavailable health.

#### Scenario: Unavailable adapter is not the default
- **WHEN** runtime defaults are loaded and the previously preferred adapter reports unavailable (for example, its binary is not found on PATH)
- **THEN** the system selects the first available adapter as the active default and does not silently activate the unavailable one

#### Scenario: Defaults surface adapter health
- **WHEN** the user opens Runtime Defaults
- **THEN** each adapter shows current health, and the active default is one whose health is available; unavailable adapters are selectable only with a visible warning and setup guidance

#### Scenario: No available adapter
- **WHEN** no chat adapter is available
- **THEN** the chat composer shows a setup path (connect a provider or install an adapter) instead of defaulting into a non-functional adapter
