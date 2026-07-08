# chat-interactive-elements Specification

## Requirements

### Requirement: ask_user tool contract
The native tool runtime SHALL expose an `ask_user` tool the agent can call to
present one or more questions to the user. Each question SHALL carry an id, a
prompt, a kind (`options`, `multi`, `confirm`, or `text`), an optional option
list (label + optional description), an optional recommended-option index, and
an optional allow-free-text flag. The tool SHALL be available to native chat
turns and to planning pipeline turns. Question and option text SHALL render as
escaped text only — never interpreted as HTML, markup, or commands.

#### Scenario: Agent asks with options
- **WHEN** the agent calls `ask_user` with one `options` question carrying
  three options and a recommended index
- **THEN** a question card renders in the transcript with three clickable
  option buttons, the recommended option visibly marked, and each button
  carrying a `title=` tooltip

#### Scenario: Multiple questions in one call
- **WHEN** the agent calls `ask_user` with three questions in one call
- **THEN** all three render in one card, each independently answerable, and
  the tool result returns all answers keyed by question id

#### Scenario: Hostile text is inert
- **WHEN** a question prompt or option label contains HTML tags or script-like
  text
- **THEN** the text renders escaped and inert; nothing is interpreted or
  executed

### Requirement: Loop pauses awaiting an answer
When `ask_user` is called, the agent loop SHALL pause that iteration, persist
the pending interaction durably, and resume with the answers as the tool
result once the user responds. Pending interactions SHALL survive frontend
unmounts and app restarts. Cancelling the run SHALL resolve the interaction as
`cancelled` and unblock the loop. There SHALL be no automatic timeout that
fabricates an answer.

#### Scenario: Answer resumes the loop
- **WHEN** the user clicks an option on a pending question card
- **THEN** the loop resumes with the selected answer as the `ask_user` tool
  result and the card renders in an answered state showing the choice

#### Scenario: Restart preserves the pending question
- **WHEN** the app restarts while a question is pending
- **THEN** the session reloads with the question card still pending and
  answerable, or — if the run was marked interrupted by the orphan sweep — the
  card shows a cancelled state; no phantom running state remains

#### Scenario: Cancel resolves the interaction
- **WHEN** the user cancels the run while a question is pending
- **THEN** the interaction resolves as `cancelled`, the loop unblocks and
  terminates per run cancellation, and the card shows it was cancelled

### Requirement: Composer routes typed answers
While exactly one question is pending in a session and that question is a
`text` kind or has free text allowed, the chat composer SHALL route the next
typed message as the answer to that question instead of a new chat turn, with
a visible indicator that input is answering a question and an explicit escape
to send as a normal message instead.

#### Scenario: Typed answer to a text question
- **WHEN** a `text` question is pending and the user types a reply and presses
  Enter
- **THEN** the reply resolves the pending question (not a new provider turn)
  and the composer indicator clears

#### Scenario: Escape hatch to normal chat
- **WHEN** a free-text-allowed question is pending and the user chooses the
  send-as-message escape
- **THEN** the typed text is sent as a normal chat message and the question
  stays pending

### Requirement: Interaction history persists
Answered questions SHALL persist as part of the session transcript (question,
options, chosen answer, timestamps) and reload with history. The provider
request history SHALL contain the answers as tool results only — question
cards are a rendering concern.

#### Scenario: History reload shows answered cards
- **WHEN** a session containing answered questions is reopened
- **THEN** the transcript shows each question card in its answered state with
  the recorded choice

### Requirement: Skills drive selection through ask_user
The bundled `basebuild-planning` and `basebuild-project-schematic` skills
SHALL instruct the agent to use `ask_user` (when the tool is available) for
their decision points — category confirmation, idea picking rounds, promote
confirmation, wizard section confirmations, and re-align approvals — falling
back to prose questions when the tool is absent (e.g. foreign harnesses).

#### Scenario: Idea picking uses option cards
- **WHEN** an ideation round completes in a native chat turn
- **THEN** the picking step presents the generated ideas through `ask_user`
  (multi-select) rather than asking the user to type numbers

#### Scenario: Foreign harness degrades to prose
- **WHEN** the planning skill runs in a harness with no `ask_user` tool
- **THEN** the skill's flows still work through prose questions and typed
  answers

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
