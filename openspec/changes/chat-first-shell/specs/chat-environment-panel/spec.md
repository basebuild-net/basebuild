# chat-environment-panel Specification (delta)

## ADDED Requirements

### Requirement: Floating environment block
The system SHALL render a compact environment block floating at the top-right of
the chat surface. The block SHALL float above the transcript without displacing
chat content, SHALL be collapsible, and SHALL show a minimal summary (current
branch and a health/status dot) when collapsed.

#### Scenario: Floats over chat
- **WHEN** a chat is active and the environment block is expanded
- **THEN** the block overlays the top-right of the chat surface and the
  transcript layout does not shift to accommodate it

#### Scenario: Collapsed summary
- **WHEN** the environment block is collapsed
- **THEN** it shows only the current branch name and a status dot, and can be
  re-expanded

### Requirement: Changes and source fold
The environment block SHALL include a source fold showing the current git
branch, ahead/behind counts, and staged / unstaged / untracked counts, with
inline commit, push, and pull actions. A detailed diff/file list SHALL open as a
popover from the block rather than as a persistent column.

#### Scenario: Source summary
- **WHEN** the repository has uncommitted changes
- **THEN** the source fold shows the branch and the staged/unstaged/untracked
  counts

#### Scenario: Commit and push inline
- **WHEN** the user commits and pushes from the source fold
- **THEN** the change is committed and pushed and the counts refresh

#### Scenario: Diff in a popover
- **WHEN** the user opens the change detail
- **THEN** the diff/file list opens as a popover from the block, not as a
  full-height side column

### Requirement: Plans and ideas fold
The environment block SHALL host the Planning Inspector (`Plans / Ideas /
Categories`) as a fold, folded by default, preserving its existing behavior
(status lanes, idea catalog with filters and promote/reject, category
drill-down, schematic health badge, and end-goal nudge). Idea and category
generation SHALL remain triggered from the chat composer's planning menu, not
from this fold.

#### Scenario: Inspector relocated unchanged
- **WHEN** the user opens the Plans & Ideas fold
- **THEN** the Planning Inspector renders with the same tabs and actions it had
  in the former right panel

#### Scenario: Generation stays in the composer
- **WHEN** the user wants to generate ideas or categories
- **THEN** the trigger is the chat composer's planning menu; the fold provides
  inspection and management only

### Requirement: Files entry opens the modal
The environment block SHALL provide a single Files control that opens the
file-explorer modal. The block SHALL NOT render an always-visible file tree or
list.

#### Scenario: Files button opens modal
- **WHEN** the user activates the Files control
- **THEN** the file-explorer modal opens and no inline file tree is shown in the
  block
