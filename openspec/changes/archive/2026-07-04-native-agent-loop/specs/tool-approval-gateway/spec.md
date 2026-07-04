## ADDED Requirements

### Requirement: Approval modes
The system SHALL support per-project approval modes: `safe` (every tool call prompts), `balanced` (read-only tools auto-allowed inside the workspace; `write_file`, `edit_file`, `run_command` prompt), and `auto` (no prompts; everything auto-allowed within workspace scoping). The default for new projects SHALL be `balanced`. The active mode SHALL be visible in the chat UI and changeable without restart.

#### Scenario: Balanced mode
- **WHEN** the mode is `balanced` and the model calls `read_file` then `edit_file`
- **THEN** the read executes without a prompt and the edit blocks on an approval prompt

#### Scenario: Auto mode still enforces scoping
- **WHEN** the mode is `auto` and the model attempts a path escape or a command outside the workspace cwd
- **THEN** the call is denied by scoping rules regardless of mode

### Requirement: Approval prompts and session rules
Prompted calls SHALL render an inline approval card (tool, arguments, diff preview for edits, exact command text for commands) with actions: allow once, allow for session (per tool kind, or per command prefix for `run_command`), and deny. Denials SHALL return a denial result to the model rather than aborting the loop. Session rules SHALL expire with the session; persistent per-project rules SHALL be editable in Settings.

#### Scenario: Allow for session
- **WHEN** the user chooses "allow `run_command` starting with `npm test` for this session"
- **THEN** subsequent matching commands run without prompting while non-matching commands still prompt

#### Scenario: Deny feeds back to the model
- **WHEN** the user denies an `edit_file` call
- **THEN** the model receives a denial result naming the denied action and the loop continues, allowing the model to propose an alternative

#### Scenario: Unanswered prompt does not hang forever
- **WHEN** an approval prompt stays unanswered past its timeout (default 10 minutes)
- **THEN** the call is denied with a timeout reason and the run pauses awaiting user input

### Requirement: Audit of approval decisions
Every approval decision (auto or manual, allowed or denied, with rule provenance) SHALL be recorded on the tool event row and viewable from the session.

#### Scenario: Decision provenance
- **WHEN** a call is auto-allowed by a session rule
- **THEN** its tool event records the decision, the rule that matched, and that no prompt was shown
