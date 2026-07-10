# provider-model-catalog Specification (delta)

## ADDED Requirements

### Requirement: Credential Save and Rotation from Settings
The Settings Model Providers surface SHALL persist API-key credentials
through the credential store on Save — for both the initial connect flow
and the Update key flow on an already-connected provider. A failed save
SHALL keep the user's draft input and surface the error inline. A
successful save SHALL clear the draft, close the update form, and refresh
the catalog so the provider reflects its connected state.

#### Scenario: Connect a provider by API key from Settings
- **WHEN** the user pastes an API key for an unconfigured provider in
  Settings and clicks Save
- **THEN** the credential is persisted via `native_save_provider_credential`
  and the provider row shows connected after the catalog refresh

#### Scenario: Rotate the key of a connected provider
- **WHEN** the user opens Update key on a connected provider, enters a new
  key, and clicks Save
- **THEN** the credential is upserted for the same provider id and the
  provider remains connected

#### Scenario: Save fails
- **WHEN** the credential store rejects the save
- **THEN** the draft input is preserved, an inline error is shown, and the
  provider's connection state is unchanged
