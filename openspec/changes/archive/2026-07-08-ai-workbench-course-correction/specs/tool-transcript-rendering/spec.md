# tool-transcript-rendering Specification

## MODIFIED Requirements

### Requirement: Tool cards in the transcript
The system SHALL normalize native and OMP-backed agent events into one ordered
activity timeline containing assistant text, reasoning availability, tool
calls, questions, captures, approvals, notices, errors, and completion. Every
active run SHALL show its latest operation and status; the UI SHALL NOT leave a
run at an unexplained prose-only "gathering information" state.

#### Scenario: Agent reads files then asks a question
- **WHEN** a planning agent reads repository files and emits an `ask_user`
  question
- **THEN** the reads appear as tool activity in order, the question appears as
  an interactive blocking card, and answering it resumes the same run once

#### Scenario: Transport cannot expose activity
- **WHEN** a provider transport cannot produce the event contract required by a
  managed planning run
- **THEN** the run is prevented before send with a visible capability error
  rather than pretending to execute tools

### Requirement: Grouped tool activity
Consecutive activity items in one assistant turn SHALL collapse into a dense
group that shows aggregate status, count, and latest operation while preserving
the ordered individual cards on expansion. Waiting-for-user, approval-required,
failed, cancelled, and completed states SHALL remain visually distinct.

#### Scenario: Long planning run remains readable
- **WHEN** a run emits many context reads, tool calls, and captures
- **THEN** one compact live group preserves transcript readability while its
  expanded view exposes every ordered item and current blocker

