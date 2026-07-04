## MODIFIED Requirements

### Requirement: Renderer Crash Visibility
The system SHALL show a visible crash report when the renderer encounters an uncaught render error or unhandled async error.

#### Scenario: Renderer crashes during user interaction
- **WHEN** a user interaction triggers an uncaught renderer error
- **THEN** the app shows a crash report with the error source and details instead of a black window

#### Scenario: User needs recovery actions
- **WHEN** the crash report is displayed
- **THEN** the user can reload the app UI and copy the error details for debugging
