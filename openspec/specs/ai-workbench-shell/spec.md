# ai-workbench-shell Specification

## Requirements

### Requirement: One owned destination per workflow stage
The system SHALL provide one top-level project command strip whose Schematic,
Ideas, Plans, Running, Done, and Changes controls open their exact owned
surface. The system SHALL NOT route a stage to a sibling tab, create a surrogate
chat, or expose a duplicate chat-level entry point for the same action.

#### Scenario: User opens each planning stage
- **WHEN** the user selects Schematic, Ideas, and Plans in sequence
- **THEN** Schematic opens the Project Schematic modal, Ideas opens the Planning
  modal with Ideas active, and Plans opens the same modal with Plans active

### Requirement: Compact context remains legible
The system SHALL show project, workspace/worktree, branch, model, assigned plan,
and run state once in the active chat context header. At compact widths the
values SHALL truncate into tooltip-backed badges without overlapping actions,
wrapping into raw text, or hiding required context.

#### Scenario: Chat renders at minimum width
- **WHEN** Basebuild renders a chat at the supported 960x640 window size
- **THEN** the transcript and composer remain usable and every required context
  value is visible or available from its tooltip without overlapping controls

### Requirement: Project modals have stable loading and layout
The system SHALL render Schematic, Planning, Changes, Files, and Settings in
project-owned modals with visible loading, empty, error, and retry states.
Settings SHALL keep its navigation beside its content, and planning content
SHALL fill the modal instead of inheriting a narrow dock layout.

#### Scenario: Slow modal content loads
- **WHEN** the user opens a project modal while its data is still loading
- **THEN** the modal frame and named loading state paint immediately and do not
  display a blank body or stale content from another project

### Requirement: Dense configuration uses modal workspaces
The system SHALL use named modal workspaces for searchable catalogs, multi-step
configuration, previews, and multi-column content. Small popovers SHALL be
limited to short single-step choices. Opening configuration SHALL prioritize
legibility and capacity over keeping the chat transcript unobscured.

#### Scenario: Provider configuration opens
- **WHEN** the user clicks either provider or model in the composer
- **THEN** one provider/model modal opens with a dense provider grid, adjacent
  searchable model list, clear close action, and no cramped inline dropdown

### Requirement: Persistent bars contain only owned context and actions
The system SHALL remove duplicate project/model/session metadata and ambiguous
inactive placeholders from persistent bars. Each remaining control SHALL have
a visible label or conventional icon plus tooltip, and the same action SHALL
NOT appear in adjacent bars without a distinct scope.

#### Scenario: Idle chat header renders
- **WHEN** a chat has no assigned plan or active run
- **THEN** the header does not show raw session ids, “no plan”, duplicate
  provider/model/project chips, or unexplained fallback terminology
