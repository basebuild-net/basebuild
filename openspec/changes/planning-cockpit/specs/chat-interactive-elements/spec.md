<!-- Base: `chat-interactive-elements` delta in `planning-command-center`
     (archive that change first; these requirements are additive to it). -->

## ADDED Requirements

### Requirement: Interactive coverage for OMP-routed chats
Native chat turns that route through OMP RPC (per-turn delegation or a
persistent RPC session) SHALL surface agent questions as the same interactive
question cards as native agent-loop turns: OMP user-input/ask frames and
`ask_user` tool calls SHALL be intercepted, persisted as pending interactions,
rendered as cards, and answered back over the RPC channel. A chat runtime
where structured questions are impossible (raw terminal pty) SHALL be the only
excluded surface, and planning flows SHALL NOT be launched into such a surface
by default.

#### Scenario: OMP-routed wizard asks with cards
- **WHEN** the schematic wizard runs in a chat whose provider routes through
  OMP RPC and the agent asks a multiple-choice question
- **THEN** a question card with clickable options renders in that chat's
  transcript, and the selected answer returns to the OMP process — the
  transcript never instructs the user to "reply with A/B"

#### Scenario: Answer round-trips over RPC
- **WHEN** the user clicks an option on a card raised by an OMP user-input
  frame
- **THEN** the serialized answer is written back to the OMP session, the run
  resumes, and the card renders answered

### Requirement: Prose-question quick replies
When a completed assistant message contains an enumerated prose question
(lettered/numbered options such as "A) … B) …" or "reply with A/B"-style
phrasing), the transcript SHALL render quick-reply chips for the detected
options beneath the message, plus a free-text affordance. Clicking a chip
SHALL send that reply as a normal user message (visible in the transcript);
detection SHALL be conservative (no chips on ambiguous text), all chip text
SHALL render escaped, and chips SHALL never auto-send without a click. Chips
are a degraded-mode fallback and SHALL NOT suppress or replace `ask_user`
cards.

#### Scenario: Lettered options become chips
- **WHEN** an assistant message ends with "Reply with A or B: A) keep the
  current schema B) migrate now"
- **THEN** chips "A — keep the current schema" and "B — migrate now" render
  under the message, and clicking one sends that choice as the next user
  message

#### Scenario: Ambiguous prose gets no chips
- **WHEN** an assistant message merely mentions "option A" in running text
  without an enumerated question
- **THEN** no chips render

#### Scenario: Hostile option text stays inert
- **WHEN** a detected option label contains HTML or script-like text
- **THEN** the chip renders the text escaped and clicking sends it as plain
  text only

### Requirement: Managed confirmation dialogs
Confirm-gated planning, launch, archive, completion, and source-control
actions SHALL use the app's managed dialog/card components — enumerating the
concrete consequences and offering explicit confirm/cancel — with `title=`
tooltips and 0px radius. Native browser/webview dialogs (`window.confirm`,
`window.alert`, `window.prompt`) are PROHIBITED in these flows.

#### Scenario: Batch launch confirms in-app
- **WHEN** the user triggers a batch launch of two plans
- **THEN** a managed dialog enumerates the plan→destination mapping,
  worktrees, branches, and providers, and no native dialog appears

#### Scenario: Cancel is honored
- **WHEN** the user cancels a managed confirmation
- **THEN** the action performs no work and focus returns to the invoking
  surface
