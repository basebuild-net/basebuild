# provider-model-catalog Specification (delta)

## ADDED Requirements

### Requirement: Credential Rotation UI
Configured providers SHALL expose an Update key affordance in both the
Settings model-providers panel and the chat provider picker. The
affordance SHALL open the existing key entry flow (password input, never
displaying the stored secret) and persist via the existing upsert path.
Saving a new key SHALL unblock a previously disconnected provider and
refresh that provider's catalog.

#### Scenario: Update key from Settings
- **WHEN** a provider is configured and the user activates Update key in Settings
- **THEN** a password key input appears, saving upserts the credential, the input clears, and the provider remains connected with the new key

#### Scenario: Update key never reveals the old secret
- **WHEN** the Update key input is shown
- **THEN** the existing stored key is not rendered, pre-filled, or otherwise exposed

#### Scenario: Update key from the chat picker
- **WHEN** a provider card in the chat provider picker is configured
- **THEN** it offers both Disconnect and Update key actions, and Update key opens the same connect modal in update mode titled for that provider

### Requirement: Typed Provider Availability States
The provider picker and composer SHALL present each provider/model in one
of the typed states: `ready`, `setup_required` (no credential),
`transport_unavailable` (no native transport for the model's API kind and
no custom base URL), or `error` (last catalog/discovery failure). Each
non-ready state SHALL name its cause and its remedy in visible text or
tooltip. The native profile SHALL NOT present a bespoke-transport model as
ready.

#### Scenario: Transport unavailable is pre-launch
- **WHEN** a model's API kind has no native transport and no custom base URL is configured
- **THEN** the picker shows `transport unavailable` for it with an explanation and a custom-base-URL affordance, and selecting it does not start a provider request

#### Scenario: Provider error chip with retry
- **WHEN** a provider's last catalog refresh recorded an error
- **THEN** the picker shows an error chip with the error text in a tooltip and a retry action that refreshes only that provider

#### Scenario: Ready means usable
- **WHEN** a provider shows `ready` and one of its models is selected
- **THEN** sending a message starts a provider request without any additional setup prompt
