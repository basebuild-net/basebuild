## ADDED Requirements

### Requirement: Persistent OMP RPC chat profile
The system SHALL provide an `omp-rpc` chat runtime profile that runs a
persistent `omp --mode rpc` process per session (hidden spawn, session and
tools enabled — unlike the existing one-shot `--no-tools --no-session`
bridge), exchanging line-delimited JSON frames over stdio. The profile SHALL
be selectable wherever chat profiles are, SHALL be offered only when an
installed OMP passes a version/capability probe, and SHALL surface process
exit as a session-ended state with visible history retained (per the existing
agent session contract).

#### Scenario: Start an OMP RPC chat
- **WHEN** the user selects the `omp-rpc` profile and sends a message
- **THEN** a persistent OMP RPC process serves the session and the reply
  streams into the native transcript, with no PTY or terminal emulation
  involved

#### Scenario: OMP missing hides the profile
- **WHEN** OMP is not installed or the probe fails
- **THEN** the profile is shown unavailable with the reason, and selecting it
  is prevented rather than failing at send time

#### Scenario: Process exit ends the session visibly
- **WHEN** the OMP process exits mid-session
- **THEN** the chat marks the session ended, disables send until restarted,
  and retains the visible conversation

### Requirement: Native rendering of RPC frames
OMP RPC frames SHALL render through the native transcript components: text
deltas append to the assistant turn, reasoning deltas to the collapsed
thinking fold, and tool activity to tool cards. Frames are untrusted child
process output: parsing SHALL be tolerant (malformed lines skipped, unknown
frame kinds rendered as inert collapsed debug rows), SHALL never execute or
interpolate frame content, and SHALL never crash the session on unexpected
input.

#### Scenario: Streaming text renders natively
- **WHEN** OMP emits `text_delta` frames
- **THEN** the transcript appends them to the current assistant message
  exactly like native-harness streaming

#### Scenario: Unknown frame kind is inert
- **WHEN** OMP emits a frame kind the bridge does not recognize
- **THEN** the session continues; the frame appears at most as a collapsed
  debug row rendered as escaped text

### Requirement: OMP questions render as interactive cards
When an OMP session emits a user-input request frame (its ask/question
surface), the bridge SHALL render it as the same interactive question card
used by the native `ask_user` tool, and SHALL return the user's selection to
OMP in the frame format it expects. Cancelling the session SHALL resolve the
pending request toward OMP rather than leaving it hung.

#### Scenario: OMP question becomes a card
- **WHEN** an OMP RPC session requests user input with options
- **THEN** a question card with option buttons renders in the transcript, and
  the chosen option is returned to OMP over stdin

#### Scenario: Cancel unblocks OMP
- **WHEN** the user cancels while an OMP question is pending
- **THEN** the bridge sends the protocol's cancel/abort response and the
  session returns to a non-hung state

### Requirement: Plan runs can target the RPC profile
Plan-chat assignment SHALL support the `omp-rpc` profile as the executing
chat, with run streaming, status transitions, and completion handling equal to
native-harness runs (including worktree provisioning and integration-queue
handoff).

#### Scenario: Run a plan through OMP RPC
- **WHEN** a ready plan is assigned to a chat using the `omp-rpc` profile
- **THEN** the run seeds and streams in that chat, the plan badge and status
  transitions behave as with the native harness, and finish lands the run in
  the integration queue
