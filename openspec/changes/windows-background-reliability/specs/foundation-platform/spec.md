## MODIFIED Requirements

### Requirement: First-Run Foundation Setup

The system SHALL guide new users through essential local-first defaults, including Windows background startup, before agent chat, terminal, or analytics features perform sensitive actions. Choices that register an operating-system side effect SHALL be applied only when the user completes setup; choices that upload data SHALL require separate explicit consent.

#### Scenario: First run opens setup

- **WHEN** a user opens Basebuild for the first time
- **THEN** the app presents a compact setup flow for default terminal, default chat adapter, Windows launch at sign-in, privacy/analytics posture, and permission behavior

#### Scenario: Launch at sign-in defaults on within setup

- **WHEN** a new Windows user reaches the background-startup step
- **THEN** launch at sign-in is selected by default, the app explains that autostart launches stay minimized in the tray, and the user can turn the selection off before finishing

#### Scenario: Remote usage sync remains explicit

- **WHEN** first-run setup explains hourly account usage sync
- **THEN** collection and upload remain disabled unless the signed-in user explicitly enables the required consent and sync controls

#### Scenario: User skips setup

- **WHEN** the user skips first-run setup
- **THEN** the app uses conservative defaults: OMP chat adapter, platform terminal, analytics disabled, auto-send disabled, ask-before-sensitive-action permissions, no new autostart registration, and no remote usage sync

#### Scenario: Setup can be revisited

- **WHEN** the user opens settings later
- **THEN** every first-run default, including launch at sign-in and account usage sync, can be reviewed and changed
