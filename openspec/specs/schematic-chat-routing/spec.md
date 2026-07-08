# schematic-chat-routing Specification

## Requirements

### Requirement: Destination chooser for planning turns
When a planning turn (schematic wizard create/edit/re-align, auto-create
schematic, or any planning action that launches a chat turn) is started from a
surface that is not itself a chat panel, the system SHALL present a
destination chooser before anything is inserted or sent: **new conversation**,
or **one of the currently open chat windows/tabs** (listed with tab title,
panel position, model, and busy/idle state), with an explicit cancel. Busy
chats (streaming or holding a pending interaction) SHALL be marked and
selecting one SHALL warn before queueing the prompt. The chooser SHALL be a
managed in-app dialog with `title=` tooltips and 0px radius — never a native
dialog.

#### Scenario: Choose an existing tab
- **WHEN** the user clicks "Start wizard" on the schematic surface and picks
  "Chat 2" in the destination chooser
- **THEN** the wizard prompt is delivered to Chat 2's chat session, Chat 2 is
  focused, and no other chat panel receives any draft text

#### Scenario: Choose a new conversation
- **WHEN** the user picks "New conversation" in the destination chooser
- **THEN** a new chat panel is created, the prompt is delivered to that new
  chat session after it is ready, and delivery happens exactly once

#### Scenario: Cancel delivers nothing
- **WHEN** the user dismisses the destination chooser
- **THEN** no chat is created, no draft is inserted anywhere, and no message
  is sent

### Requirement: Targeted single-shot prompt delivery
Prompt delivery SHALL be keyed to a specific chat session id — never broadcast
to all mounted chat panels — and SHALL resolve exactly once per user action.
Delivery SHALL distinguish **insert** (prompt appears in that chat's composer
for user editing, composer focused) from **insert-and-send** (message sent as
a user turn; the composer is left empty afterwards). A delivery whose
auto-send precondition is not yet met (e.g. model catalog still loading) SHALL
wait for readiness and then send once — it SHALL NOT silently consume the
prompt, and repeating the launching action SHALL NOT stack duplicate inserts
or sends.

#### Scenario: Auto-send leaves a clean composer
- **WHEN** a wizard prompt is delivered as insert-and-send to a ready chat
- **THEN** the prompt is sent as one user message, the transcript shows one
  turn, and the composer input is empty

#### Scenario: Not-ready chat defers, then sends once
- **WHEN** the prompt is delivered while the target chat's provider catalog is
  still loading
- **THEN** the send fires exactly once when the chat becomes ready; clicking
  the original action a second time before readiness does not produce a second
  insertion or send

#### Scenario: Tool-incapable model blocks the send with guidance
- **WHEN** the destination chat's active model does not support tool calling
  and the prompt requires tools (wizard)
- **THEN** the prompt is inserted without sending and an inline notice names
  the constraint and offers switching model — nothing is auto-sent

### Requirement: Deterministic schematic entry points
Every schematic entry point SHALL produce a visible result in every project
state: opening the schematic surface from the panels list, the flow board's
Schematic stage, or the planning menu SHALL focus an existing schematic
surface or open one (never a silent no-op), and SHALL work identically across
projects in the same app session.

#### Scenario: Schematic click in a second project
- **WHEN** the user switches to another open project and clicks its
  "Project schematic" entry
- **THEN** that project's schematic surface opens or is focused, showing that
  project's `.basebuild/project-schematic.md` state (or its empty-state wizard
  call-to-action)
