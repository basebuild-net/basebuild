# provider-web-login Specification (delta)

## MODIFIED Requirements

### Requirement: Web/OAuth Provider Login
The system SHALL let users connect a model provider through a web/OAuth-style
flow in addition to manual API-key entry, persisting the resulting credential
locally only after explicit user consent. OAuth flows SHALL reuse Oh My Pi's
credential store and login machinery (which ships the vendors' public client
IDs and handles token refresh) — Basebuild SHALL NOT require registering its
own OAuth applications, and SHALL NOT implement first-party OAuth token
exchange in this change.

#### Scenario: Connect via web flow
- **WHEN** the user chooses "Connect with {provider}" for a provider that supports web login
- **THEN** the system opens the provider's authorization page in the system browser, captures the returned token via a loopback callback or device-code exchange, persists it to the local credential store, and marks the provider configured

#### Scenario: Manual API key still available
- **WHEN** a provider does not support web login or the user prefers a key
- **THEN** the user can enter an API key (and optional base URL) manually, and it is persisted through the same local credential store

#### Scenario: Secrets are handled safely
- **WHEN** a credential is obtained through any flow
- **THEN** the secret is never placed in a URL query string, never logged, and is stored only in the local credential store

#### Scenario: Catalog reflects connection immediately
- **WHEN** a provider becomes connected through either flow
- **THEN** the provider catalog refreshes so the provider shows as configured and its models become selectable in the composer without an app restart

#### Scenario: Disconnect
- **WHEN** the user disconnects a provider
- **THEN** the stored credential is removed, the provider returns to setup-required, and any chat defaulting to that provider falls back to an available adapter

#### Scenario: OMP credentials cover every mapped provider
- **WHEN** OMP's credential store contains an entry (API key or OAuth) for any
  provider Basebuild knows from the vendored catalog — not only
  `umans`/`openai`/`anthropic`
- **THEN** that provider shows as configured in Basebuild without re-entering
  a key; API keys are read from the store, and OAuth access tokens are
  resolved via `omp token <provider>` with a short-lived in-memory cache
  (refresh handled by OMP; tokens never logged or persisted by Basebuild)

#### Scenario: Login via OMP
- **WHEN** the user chooses "Login via OMP" for an OAuth provider (e.g. Devin)
  and OMP is installed
- **THEN** the system opens a terminal running `omp login <provider>`, and on
  completion re-reads the credential store and refreshes that provider's
  catalog so its models become selectable

#### Scenario: OAuth provider without OMP
- **WHEN** OMP is not installed and a provider supports only OAuth
- **THEN** the provider's setup state explains that connecting it requires OMP
  (with an install pointer) instead of offering a dead-end key prompt
