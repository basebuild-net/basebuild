# provider-web-login Specification

## Requirements

### Requirement: Web/OAuth Provider Login
The system SHALL let users connect a model provider through a web/OAuth-style flow in addition to manual API-key entry, persisting the resulting credential locally only after explicit user consent.

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
