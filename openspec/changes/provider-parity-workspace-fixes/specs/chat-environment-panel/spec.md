# chat-environment-panel Specification (delta)

> Base requirements are the `chat-first-shell` change's delta (in flight). This
> change modifies them; archive `chat-first-shell` first so these merge onto
> the canonical capability.

## MODIFIED Requirements

### Requirement: Changes and source fold
The environment block SHALL include a source fold showing the current git
branch, ahead/behind counts, and staged / unstaged / untracked counts, with
inline commit, push, and pull actions. A detailed diff/file list SHALL open as a
popover from the block rather than as a persistent column. When the detail
surface is hosted in a modal or popover, the source panel SHALL reflow to fill
the host container's width and height — never rendering as a narrow
sidebar-width column beside empty space, and never overflowing its tab row
without an accessible way to reach hidden tabs.

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

#### Scenario: Detail surface fills its host
- **WHEN** the Changes detail opens in a modal or popover
- **THEN** the file list and diff area use the full host width, with no large
  unused region and no clipped controls

### Requirement: Plans and ideas fold
The environment block SHALL host the Planning Inspector (`Plans / Ideas /
Categories`) as a fold, folded by default, preserving its existing behavior
(status lanes, idea catalog with filters and promote/reject, category
drill-down, schematic health badge, and end-goal nudge). Idea and category
generation SHALL remain triggered from the chat composer's planning menu, not
from this fold. Wherever the inspector is hosted (fold, modal, or popover), it
SHALL reflow to the host container's width; controls that are meaningless in
the host context (e.g. the dock-collapse toggle inside a modal) SHALL be
hidden; the idea status filters SHALL render as visually separated chips; and
the schematic health badge SHALL be visually distinct from the tab controls
and identifiable as a non-interactive status indicator.

#### Scenario: Inspector relocated unchanged
- **WHEN** the user opens the Plans & Ideas fold
- **THEN** the Planning Inspector renders with the same tabs and actions it had
  in the former right panel

#### Scenario: Generation stays in the composer
- **WHEN** the user wants to generate ideas or categories
- **THEN** the trigger is the chat composer's planning menu; the fold provides
  inspection and management only

#### Scenario: Inspector fills a modal host
- **WHEN** the Planning Inspector renders inside the Plans & Ideas modal
- **THEN** its tabs, lists, and detail views use the modal's full content
  width, the tab row does not overflow into a hidden state, and no collapse
  toggle is shown

#### Scenario: Filter chips are separated
- **WHEN** the Ideas tab renders its status filters
  (All/Concept/Picked/Rejected/Archived)
- **THEN** each filter renders as a distinct chip with visible spacing and an
  active-state treatment — never as one run-on text string

#### Scenario: Health badge reads as status
- **WHEN** the schematic health badge (e.g. `missing`) renders next to the
  tabs
- **THEN** it is visually distinguishable from the tab buttons, exposes its
  explanation via tooltip, and does not present a click affordance
