# provider-model-catalog Specification (delta)

## MODIFIED Requirements

### Requirement: Automatic Model Catalog Sync
The system SHALL sync model catalogs automatically and expose manual refresh
when the user needs newer model information. The bundled (offline) catalog
SHALL be generated from vendored Oh My Pi catalog data
(`src-tauri/vendor/omp-catalog/models.json`, MIT-attributed) rather than
hand-maintained code, covering every provider and model in that data, and each
model SHALL retain its wire-protocol kind (`api`), base URL, context window,
max tokens, reasoning capability, image-input capability, and cost metadata.

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

#### Scenario: Bundled catalog covers OMP provider parity
- **WHEN** the catalog is built with no cached rows and no credentials
- **THEN** every provider present in the vendored OMP catalog data is listed
  with its bundled models (Devin alone exposes its full ~48-model list,
  including `swe-1-6` and `glm-5-2`), sourced as `bundled`

#### Scenario: Stale bundled cache is replaced
- **WHEN** the app starts with cached rows whose source is `bundled` and the
  embedded catalog's version stamp differs from the stamp stored with those
  rows
- **THEN** the bundled-source rows are replaced by the current bundled catalog
  (a stale row such as `devin-2.0` cannot suppress current bundled models),
  while rows sourced from live discovery or catalog sync are preserved

#### Scenario: Bundled-only provider refresh succeeds
- **WHEN** the user refreshes a provider whose models come only from the
  bundled catalog (no live discovery endpoint, e.g. Devin without OMP)
- **THEN** the refresh replaces the cache with the current bundled list and
  reports success — it does not record an error while preserving stale rows

#### Scenario: OMP CLI is a discovery source
- **WHEN** OMP is installed and a provider's models cannot be discovered via a
  native endpoint
- **THEN** Basebuild may read `omp models <provider> --json --no-extensions`
  as an authoritative payload, marking the source accordingly, with the
  bundled catalog as the fallback when the CLI call fails

## ADDED Requirements

### Requirement: Catalog Scale Usability
The model picker SHALL remain usable at catalog scale (tens of providers,
thousands of models): models SHALL be filterable by substring search, providers
with configured credentials SHALL be surfaced before unconfigured ones, and
rendering SHALL not degrade the UI at full catalog size.

#### Scenario: Search narrows the model list
- **WHEN** the user types a substring (e.g. "swe") in the model picker
- **THEN** the list narrows to matching models across providers without
  perceptible lag

#### Scenario: Configured providers listed first
- **WHEN** the picker opens with some providers configured
- **THEN** configured providers and their models appear before unconfigured
  ones, which remain reachable (with their setup state visible)
