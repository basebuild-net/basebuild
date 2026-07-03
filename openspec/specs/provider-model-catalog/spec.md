# provider-model-catalog Specification

## Requirements

### Requirement: Multi-Provider Connection State
The system SHALL support multiple connected model providers at the same time and SHALL store provider credentials and provider metadata locally.

#### Scenario: Connect another provider
- **WHEN** the user connects a provider while another provider is already connected
- **THEN** both providers remain connected, their connection states are visible, and the user can switch between their models without disconnecting either provider

#### Scenario: Credential storage remains local
- **WHEN** a provider credential is saved by web login or API-key entry
- **THEN** the secret is stored only in the local credential store, never logged, never sent to Basebuild hosted services, and never placed in a URL query string

#### Scenario: Provider metadata is persisted
- **WHEN** a provider is connected or its model catalog is refreshed
- **THEN** the system persists non-secret metadata such as provider id, label, configured state, last sync time, model count, model source, and sync error state for local display

### Requirement: Automatic Model Catalog Sync
The system SHALL sync model catalogs automatically and expose manual refresh when the user needs newer model information.

#### Scenario: Startup sync uses cache first
- **WHEN** Basebuild opens a project with native chat available
- **THEN** the provider/model catalog loads from local cache immediately and schedules an online refresh for stale or missing provider model data

#### Scenario: Login triggers sync
- **WHEN** a provider login succeeds
- **THEN** the system immediately refreshes that provider's model list and makes newly available models selectable without restarting the app

#### Scenario: Manual refresh
- **WHEN** the user clicks model refresh or runs `/models refresh`
- **THEN** the system forces an online model catalog refresh, updates last-sync metadata, and keeps the previous usable model list if the refresh fails

#### Scenario: Direct model payload preferred
- **WHEN** a provider or provider CLI exposes a dedicated model-list payload
- **THEN** Basebuild uses that payload as the authoritative source for that provider's models, normalizes labels/capabilities, deduplicates entries, and caches the result locally

#### Scenario: OpenAI-compatible discovery
- **WHEN** a provider speaks OpenAI-compatible APIs and exposes `/v1/models`
- **THEN** Basebuild discovers model ids from `/v1/models`, applies provider-specific defaults for capabilities when metadata is missing, and marks the source as provider-discovered

#### Scenario: Hosted fallback only for missing payloads
- **WHEN** a provider has no dedicated supported-model payload and cannot be discovered directly
- **THEN** Basebuild may query a Basebuild model-directory endpoint for public non-secret model metadata, while keeping credentials local and marking the source as hosted-fallback

#### Scenario: Refresh failure is non-destructive
- **WHEN** model sync fails due to network, auth, or provider errors
- **THEN** the UI shows the sync error and continues offering the last successful cached models when available
