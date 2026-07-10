# testing-automation Specification (delta)

## ADDED Requirements

### Requirement: Tauri Mock Contract Fidelity
Every command handled by the e2e Tauri mock SHALL read its arguments with
the exact shape the production lib wrapper sends (including `{ input }`
envelopes) and SHALL return values matching the Rust command's serialized
contract. Commands invoked by shipped UI code SHALL NOT be absent from
the mock.

#### Scenario: Credential save round-trip under e2e
- **WHEN** the UI calls `nativeSaveProviderCredential({ providerId, label,
  apiKey, baseUrl })` under the e2e mock
- **THEN** the mock stores the credential under the supplied provider id
  with the supplied key, and the next catalog read reports that provider
  as configured

### Requirement: Behavioral Coverage for Chat Verification Paths
The e2e suite SHALL exercise, not merely render: (1) credential
persistence — saving a key flips the provider to connected; (2) streaming
— at least one spec drives phase/delta events through the
`native-chat://` event channel and asserts incremental rendering;
(3) grounding — the idea batch header assertion runs against seeded
grounding metadata, never conditionally skipped; (4) denial — a denied
tool event fixture asserts the denied card state.

#### Scenario: Grounding assertions cannot pass vacuously
- **WHEN** the idea-grounding spec runs
- **THEN** the fixture guarantees grounding metadata exists and the batch
  header assertions execute unconditionally

#### Scenario: Denial path renders denied state
- **WHEN** the denial-path spec runs against a seeded denied tool event
- **THEN** it asserts the card shows the denied status and provenance,
  not the absence of the word "denied" in an approved fixture
