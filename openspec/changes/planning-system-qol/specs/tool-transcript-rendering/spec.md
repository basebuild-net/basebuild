## ADDED Requirements

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
