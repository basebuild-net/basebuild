# composer-voice-input Specification (delta)

## ADDED Requirements

### Requirement: Microphone voice-to-text
The chat composer SHALL provide a microphone control that toggles voice-to-text
capture into the chat input. While capturing, the control SHALL show an active
recording state. Transcribed text SHALL be inserted into the input field at the
cursor position, leaving any existing draft intact. The control SHALL carry a
`title` tooltip and use 0px radius.

#### Scenario: Start capture
- **WHEN** the user activates the microphone control
- **THEN** capture begins and the control shows an active recording state

#### Scenario: Insert transcription
- **WHEN** speech is transcribed during capture
- **THEN** the transcribed text is inserted into the input at the cursor without
  discarding the existing draft

#### Scenario: Stop capture
- **WHEN** the user toggles the microphone off
- **THEN** capture stops, the control returns to its idle state, and the input
  retains the transcribed text for editing before send

#### Scenario: Capture unavailable
- **WHEN** voice capture or transcription is unavailable
- **THEN** the control communicates the unavailable state (disabled with an
  explanatory tooltip) rather than failing silently

### Requirement: Local-first voice handling
Voice capture and transcription SHALL follow the local-first policy: no audio or
transcript is uploaded to any non-provider endpoint unless the user has
explicitly enabled a provider-backed transcription path.

#### Scenario: No silent upload
- **WHEN** the user records without an explicitly enabled remote transcription
  provider
- **THEN** audio is not uploaded to any basebuild-owned or third-party endpoint
