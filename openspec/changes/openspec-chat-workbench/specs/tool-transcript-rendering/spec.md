## MODIFIED Requirements

### Requirement: Tool cards in the transcript
The system SHALL normalize native and OMP-backed agent events into one ordered activity timeline containing assistant text, reasoning/thinking blocks, individual tool calls, questions, captures, approvals, notices, errors, and completion. Every active run SHALL show its latest operation and status; the UI SHALL NOT leave a run at an unexplained prose-only `gathering information` state. Timeline rows SHALL be rendered in exact event sequence and SHALL NOT be grouped into aggregate tool lumps by default.

#### Scenario: Agent reads files then asks a question
- **WHEN** a planning agent reads repository files and emits an `ask_user` question
- **THEN** each read appears as its own tool activity row in order, the question appears as an interactive blocking card, and answering it resumes the same run once

#### Scenario: Transport cannot expose activity
- **WHEN** a provider transport cannot produce the event contract required by a managed planning run
- **THEN** the run is prevented before send with a visible capability error rather than pretending to execute tools

#### Scenario: Tool calls are not lumped
- **WHEN** one assistant turn emits `read_file`, `search_files`, and `run_command` calls
- **THEN** the transcript shows three separate timeline rows with timestamps/status, not one collapsed `3 tool calls` group

### Requirement: Edit diffs and command output
`edit_file`/`write_file` cards SHALL show a unified diff (added/removed lines); `run_command` cards SHALL show command text, size-capped interleaved output, exit code, and an `open in terminal` action that opens a workspace terminal tab at the same cwd. `read_file`/`search_files`/`list_files` cards SHALL summarize path/ranges/match counts without dumping full content. Every card SHALL carry a tool-kind color token and retain exact ordering relative to thinking and assistant text.

#### Scenario: Edit diff
- **WHEN** an `edit_file` call succeeds
- **THEN** the card renders a diff of exactly the changed region and the file path links to the file viewer

#### Scenario: Open in terminal
- **WHEN** the user clicks `open in terminal` on a command card
- **THEN** a terminal tab opens at the command's cwd without re-running the command automatically

#### Scenario: Tool kind color is redundant
- **WHEN** a read, write, edit, command, approval, or error row renders
- **THEN** color, icon, and text label all identify the kind/status

### Requirement: Budget and interruption signals
The transcript SHALL surface context-budget truncation notices, iteration-cap notices, run-interrupted notices, queue notices, dependency blockers, and OpenSpec validation blockers as distinct system rows, never silently.

#### Scenario: Truncation notice
- **WHEN** the context guard drops old turns to fit the model budget
- **THEN** a system row states that older messages were truncated for this request

#### Scenario: Queue blocker notice
- **WHEN** a run is queued because another worktree/provider slot is active
- **THEN** a system row explains the queue reason and the context strip mirrors the queued state

### Requirement: Grouped tool activity
Consecutive activity items in one assistant turn SHALL NOT collapse into one aggregate group by default. The default view SHALL preserve chronological order with separate rows for thinking, text, tool calls, tool results, approvals, questions, captures, notices, and errors. A future optional compact view MAY visually compress rows only if it preserves sequence, remains opt-in per user setting, and never hides waiting-for-user, approval-required, failed, cancelled, or completed states.

#### Scenario: Long planning run remains inspectable
- **WHEN** a run emits many context reads, tool calls, captures, and questions
- **THEN** every item remains available as its own ordered row, and the viewport auto-follows the newest running row without replacing earlier rows with a summary lump

#### Scenario: Tool call splits thinking block
- **WHEN** the model streams thinking, emits a tool call, and then streams more thinking after the tool result
- **THEN** the timeline shows `Thinking` block A, the tool call/result row, then `Thinking` block B as separate rows
