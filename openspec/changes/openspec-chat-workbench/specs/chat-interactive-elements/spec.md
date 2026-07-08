## MODIFIED Requirements

### Requirement: ask_user tool contract
The native tool runtime SHALL expose an `ask_user` tool the agent can call to present one or more questions to the user. Each question SHALL carry an id, a prompt, a kind (`options`, `multi`, `confirm`, or `text`), an optional option list (label + optional description), an optional recommended-option index, and an optional allow-free-text flag. The tool SHALL be available to native chat turns, OMP RPC-routed turns, and planning pipeline turns when the runtime supports structured questions. Question and option text SHALL render as escaped text only — never interpreted as HTML, Markdown commands, shell commands, or links that auto-execute.

#### Scenario: Agent asks with options
- **WHEN** the agent calls `ask_user` with one `options` question carrying three options and a recommended index
- **THEN** a question card renders in the transcript with three clickable option buttons, the recommended option visibly marked, and each button carrying a `title=` tooltip

#### Scenario: Multiple questions in one call
- **WHEN** the agent calls `ask_user` with three questions in one call
- **THEN** all three render in one card or one contiguous question group, each independently answerable, and the tool result returns all answers keyed by question id

#### Scenario: Hostile text is inert
- **WHEN** a question prompt or option label contains HTML tags, script-like text, or markdown links
- **THEN** the text renders escaped and inert; nothing is interpreted, executed, or opened automatically

#### Scenario: Question card appears in timeline
- **WHEN** an agent asks a blocking question after reading files
- **THEN** the question appears as the next chronological timeline row after the file-read tool row, not as an out-of-band modal detached from the run

### Requirement: Interactive coverage for OMP-routed chats
Native chat turns that route through OMP RPC (per-turn delegation or a persistent RPC session) SHALL surface agent questions as the same interactive question cards as native agent-loop turns: OMP user-input/ask frames and `ask_user` tool calls SHALL be intercepted, persisted as pending interactions, rendered as cards, and answered back over the RPC channel. A chat runtime where structured questions are impossible (raw terminal PTY) SHALL be the only excluded surface, and OpenSpec planning flows SHALL NOT launch into such a surface by default.

#### Scenario: OMP-routed wizard asks with cards
- **WHEN** an OpenSpec or schematic flow runs in a chat whose provider routes through OMP RPC and the agent asks a multiple-choice question
- **THEN** a question card with clickable options renders in that chat's transcript, and the selected answer returns to the OMP process — the transcript never instructs the user to `reply with A/B` as the primary UI

#### Scenario: Answer round-trips over RPC
- **WHEN** the user clicks an option on a card raised by an OMP user-input frame
- **THEN** the serialized answer is written back to the OMP session, the run resumes, and the card renders answered

#### Scenario: Unsupported raw terminal is blocked for planning
- **WHEN** the selected runtime can only display raw PTY text
- **THEN** OpenSpec managed planning launch is blocked with a visible capability message and a suggestion to use native or OMP RPC chat

### Requirement: Prose-question quick replies
When a completed assistant message contains an enumerated prose question (lettered/numbered options such as `A) … B) …` or `reply with A/B`-style phrasing), the transcript SHALL render quick-reply chips for the detected options beneath the message, plus a free-text affordance. Clicking a chip SHALL send that reply as a normal user message (visible in the transcript); detection SHALL be conservative (no chips on ambiguous text), all chip text SHALL render escaped, and chips SHALL never auto-send without a click. Chips are a degraded-mode fallback and SHALL NOT suppress or replace `ask_user` cards when structured questions are available.

#### Scenario: Lettered options become chips
- **WHEN** an assistant message ends with `Reply with A or B: A) keep the current schema B) migrate now`
- **THEN** chips `A — keep the current schema` and `B — migrate now` render under the message, and clicking one sends that choice as the next user message

#### Scenario: Ambiguous prose gets no chips
- **WHEN** an assistant message merely mentions `option A` in running text without an enumerated question
- **THEN** no chips render

#### Scenario: Hostile option text stays inert
- **WHEN** a detected option label contains HTML, script-like text, or markdown links
- **THEN** the chip renders the text escaped and clicking sends it as plain text only

#### Scenario: Multiple-choice UI is clickable everywhere
- **WHEN** an agent asks the user to choose categories, ideas, implementation profile, worktree policy, merge action, or final-touch action
- **THEN** the user can answer with buttons/chips/cards instead of copying a letter or typing a command
