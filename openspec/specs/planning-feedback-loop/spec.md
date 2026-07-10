# planning-feedback-loop Specification

## Requirements

### Requirement: Decision digest steers generation
Planning generation turns SHALL receive a decision digest computed at
assembly time from the local catalog: recent picked ideas (title, category,
anchor), recent rejected ideas, and plans finished since the schematic was
last written. The digest SHALL be bounded in size, derived only from local
planning data, and injected alongside the focus directive so generation
avoids re-proposing rejected directions and leans toward demonstrated
preferences.

#### Scenario: Rejected direction is not re-proposed
- **WHEN** ideas resembling a previously rejected idea's scope are candidates
  in a new generation turn
- **THEN** the turn's instructions contain the rejection digest and direct the
  model away from re-proposing rejected directions

#### Scenario: Digest is bounded
- **WHEN** the catalog contains hundreds of decided ideas
- **THEN** the digest includes only the bounded most-recent window, not the
  full history

### Requirement: Agent-maintained preferences file
The system SHALL support a `.basebuild/preferences.md` capturing inferred
planning taste (e.g. preferred scope size, rejected themes, review strictness).
The file SHALL be written only by agent turns through the existing
file-modification approval gateway (approval-gated diff, never silent), SHALL
be injected into generation instructions when present, and SHALL be editable
and deletable by the user like any project file. After notable decision
batches (batch approve/reject), the system MAY offer — never auto-run — a
"update preferences" turn that proposes deltas via interactive confirmation.

#### Scenario: Preferences injected when present
- **WHEN** `.basebuild/preferences.md` exists and a generation turn is
  assembled
- **THEN** the instructions include the preferences content after the focus
  directive

#### Scenario: Preference writes require approval
- **WHEN** an agent turn proposes updating the preferences file
- **THEN** the write goes through the file-modification approval flow showing
  the proposed content, and rejection leaves the file untouched

### Requirement: Post-completion re-align nudge
When a plan reaches `finished` and the schematic was last written before that
plan started, the system SHALL emit a re-align suggestion (notification, and a
flow-board indicator on the Schematic stage) offering to run the schematic
skill's re-align mode as a chat turn. The nudge SHALL be dismissible, SHALL
not repeat for the same plan, and accepting it SHALL launch the re-align turn
which applies only user-approved section edits.

#### Scenario: Finished plan triggers the nudge
- **WHEN** a plan finishes and the schematic predates the plan's start
- **THEN** a notification suggests re-alignment naming the finished plan, and
  the Schematic stage shows a drift indicator

#### Scenario: Accepting runs interactive re-align
- **WHEN** the user accepts the re-align suggestion
- **THEN** a chat turn runs the schematic re-align mode, presenting per-section
  drift findings and applying only sections the user approves

#### Scenario: Dismissal is remembered
- **WHEN** the user dismisses the nudge for a finished plan
- **THEN** no further nudge fires for that plan, and the next finished plan
  may nudge again
