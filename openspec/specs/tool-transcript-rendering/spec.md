# tool-transcript-rendering Specification

## Requirements

### Requirement: Tool cards in the transcript
Tool calls SHALL render as collapsed cards in message order showing tool name, argument summary, status, and duration; expanding reveals full arguments and results. Cards SHALL update live while streaming/executing. All interactive elements SHALL have tooltips and 0px radius per the design contract.

#### Scenario: Live tool card
- **WHEN** a `run_command` call executes
- **THEN** its card shows a running state with streaming output, then final exit code and duration on completion

### Requirement: Edit diffs and command output
`edit_file`/`write_file` cards SHALL show a unified diff (added/removed lines); `run_command` cards SHALL show command text, size-capped interleaved output, exit code, and an "open in terminal" action that opens a workspace terminal tab at the same cwd. `read_file`/`search_files`/`list_files` cards SHALL summarize (path + ranges, match counts) without dumping full content.

#### Scenario: Edit diff
- **WHEN** an `edit_file` call succeeds
- **THEN** the card renders a diff of exactly the changed region and the file path links to the file viewer

#### Scenario: Open in terminal
- **WHEN** the user clicks "open in terminal" on a command card
- **THEN** a terminal tab opens at the command's cwd without re-running the command automatically

### Requirement: Budget and interruption signals
The transcript SHALL surface context-budget truncation notices, iteration-cap notices, and run-interrupted notices as distinct system rows, never silently.

#### Scenario: Truncation notice
- **WHEN** the context guard drops old turns to fit the model budget
- **THEN** a system row states that older messages were truncated for this request

### Requirement: Grouped tool activity
Consecutive tool calls in a single assistant turn SHALL render as one
collapsed activity group, not N stacked cards. The collapsed group SHALL
show a running count, aggregate status, and the latest call's one-line
summary, updating live as new calls stream in. Expanding the group SHALL
reveal the individual cards in a height-capped scrollable list (newest
visible without manual scrolling while the run is active). A long agentic
run MUST NOT push the conversation text out of view with tool cards.

#### Scenario: Burst of calls collapses
- **WHEN** the agent issues 15 `list_files`/`read_file` calls in one turn
- **THEN** the transcript shows one group row ("15 tool calls · running ·
  latest: read_file openspec/…/proposal.md") instead of 15 full cards

#### Scenario: Latest call visible while running
- **WHEN** the group is expanded during a live run
- **THEN** the list auto-follows the newest call inside its capped-height
  scroll area, and stops auto-following once the user scrolls up

#### Scenario: Expand for detail
- **WHEN** the user expands the group and clicks an individual call
- **THEN** that call's full card (arguments, result, duration) opens without
  losing position in the group list
