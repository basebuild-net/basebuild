# tool-transcript-rendering Specification (delta)

## MODIFIED Requirements

### Requirement: Tool Event Cards
Each tool call SHALL render as its own card in chronological timeline
order with: a per-kind icon (read/write/edit/list/search/command/ask_user/
propose_ideas/mcp), tool name, one-line summary, status word plus icon,
and duration when available. Cards SHALL expand to show structured
arguments (key/value table; nested values pretty-printed in a code block)
and the result body. Results declared as markdown SHALL render through the
safe markdown renderer; other results render as code blocks. Expansion
state SHALL not reset while the same turn continues streaming.

#### Scenario: Card expands to structured detail
- **WHEN** the user expands a completed tool card
- **THEN** arguments render as a key/value table and the result renders as markdown or code block, capped with an explicit truncation marker when long

#### Scenario: Running tool shows live state
- **WHEN** a tool call is executing
- **THEN** its card shows a running indicator with the tool name and elapsed time, using text and icon, not color alone

## ADDED Requirements

### Requirement: Edit Diff Rendering
`edit_file` and `write_file` tool cards SHALL render a unified line diff
of the change (added/removed lines visually distinct via stylesheet
classes), generated backend-side and capped at 400 lines with head/tail
elision. When content is unchanged the card SHALL say so instead of
rendering an empty diff.

#### Scenario: Edit shows unified diff
- **WHEN** an `edit_file` call succeeds
- **THEN** the expanded card renders a unified diff with per-line add/remove markers and the count of added/removed lines in the summary

#### Scenario: Oversized diff elided
- **WHEN** a diff exceeds 400 lines
- **THEN** the card renders the head and tail with an elision marker stating how many lines were omitted

### Requirement: Approval Provenance
Every gated tool card SHALL display how its execution decision was made:
allowed/denied by user, matched rule (with the rule pattern), or approval
mode auto-decision. The provenance SHALL come from the recorded decision
fields, not be inferred client-side.

#### Scenario: User approval shown
- **WHEN** the user approves a tool call from the approval prompt
- **THEN** the tool card shows "Approved by user" alongside the result

#### Scenario: Rule match shown
- **WHEN** a session or persistent rule auto-allows a tool call
- **THEN** the tool card shows the matched rule pattern in its provenance line with a tooltip carrying the rule source
