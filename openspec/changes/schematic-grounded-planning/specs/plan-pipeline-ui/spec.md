# plan-pipeline-ui Specification (delta)

## REMOVED Requirements

### Requirement: Generate From Context Opens Chat
**Reason**: The `Generate plans` modal is removed. Generation entry points are the chat planning menu and inspector action buttons that launch agentic chat turns; there is no modal routing to replace.

### Requirement: Context Prompt Composition
**Reason**: Prompt-stuffing composition is superseded by agentic context gathering (`grounded-generation`): the turn reads the schematic and project sources itself, visibly, instead of the app assembling a one-shot prompt from a modal.

### Requirement: Generate Plans with File Context
**Reason**: The modal and its file-context picker are removed. File context is gathered by the agent through the tool loop during the generation turn.

### Requirement: Structured plan proposal capture
**Reason**: Superseded by the unified ideas catalog (`unified-planning-workspace`): structured capture writes `ideas` rows rendered as idea cards; there is no separate proposal mechanism.

### Requirement: Proposal selection state persists
**Reason**: Superseded by the ideas catalog's status history (`concept / picked / rejected / archived`), which persists per session and reloads (`Planning history and catalog access` in `plan-pipeline`).

## MODIFIED Requirements

### Requirement: Plan Generation Auditability
The system SHALL keep AI planning generation visible and reversible: generation runs only as visible chat turns (context reads, reasoning fold, incremental captures in the transcript), captured ideas SHALL be reviewable (Promote / Reject) before any plan exists, and the system SHALL NOT create placeholder plans from a generation action alone.

#### Scenario: Generation is a visible turn
- **WHEN** any planning generation runs
- **THEN** its context reads, progress, and captures render in the chat transcript — never a hidden background request

#### Scenario: Review before plans
- **WHEN** a generation turn captures ideas
- **THEN** no plan rows exist until the user promotes an idea, and rejecting an idea never creates a plan

#### Scenario: Placeholder path removed
- **WHEN** a generation action is triggered
- **THEN** the system does not create placeholder `generated` plans as a side effect

### Requirement: Chat planning quick-access menu
The chat composer SHALL expose planning generation through a compact menu
rather than a single "Generate ideas" button. The menu SHALL offer at least
`Quick ideas`, `By category…`, and `Open planning inspector`. `By category…`
SHALL list the session's project-derived categories and, when none exist,
offer "Generate categories from project" instead of seeded defaults. When
schematic health is not `complete`, the menu SHALL show a nudge linking to the
schematic wizard.

#### Scenario: Open the planning menu
- **WHEN** the user opens the chat planning menu
- **THEN** it lists `Quick ideas`, `By category…`, and `Open planning
  inspector`, each with a tooltip

#### Scenario: Generate by category from chat
- **WHEN** the user picks a category under `By category…`
- **THEN** category-directed generation runs in the transcript and ideas are
  tagged with the chosen category

#### Scenario: Empty category list offers generation
- **WHEN** the user opens `By category…` with no categories in the session
- **THEN** the menu offers "Generate categories from project" and does not list
  any seeded defaults

#### Scenario: Health nudge in the menu
- **WHEN** the user opens the planning menu while schematic health is `partial` or `missing`
- **THEN** the menu shows a schematic nudge that opens the wizard

## ADDED Requirements

### Requirement: Input-free planning inspector
The planning inspector SHALL be a catalog surface: it views and acts on plans, ideas, and categories through buttons that launch chat turns or mutate status. It SHALL NOT contain free-text generation inputs, goal input boxes, or file-context pickers; the `Generate plans` modal and the panel's goal-input generate affordances are removed. Plan CRUD editing (title/description edits on existing plans) remains available. All interactive elements SHALL have `title=` tooltips and 0px radius.

#### Scenario: No generation inputs in the panel
- **WHEN** the user opens the planning inspector
- **THEN** no free-text generation input or generate-plans modal is reachable from the panel; generation actions launch visible chat turns instead

#### Scenario: Plan editing still works
- **WHEN** the user edits an existing plan's title or description
- **THEN** the edit flow works as before; only generation input surfaces are removed

### Requirement: Schematic health and focus visibility
The planning inspector SHALL show the schematic health badge with a wizard entry action, and idea rows/cards SHALL render their `anchor` (the Vision element, End goal, or priority served) when present or an `outside current focus` flag when absent, each with explanatory tooltips.

#### Scenario: Health badge in the inspector
- **WHEN** the planning inspector renders while schematic health is `partial` or `missing`
- **THEN** the badge is visible with a tooltip naming incomplete sections and an action that opens the wizard

#### Scenario: Anchor visible on ideas
- **WHEN** an idea with an `anchor` renders in the inspector or as a chat card
- **THEN** the anchor text is visible with a tooltip; ideas without an anchor show the `outside current focus` flag
