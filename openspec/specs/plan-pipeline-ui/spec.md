# plan-pipeline-ui Specification

<!-- Created from MODIFIED delta of change 'chat-context-defaults'; base ADDED requirements live in the still-active 'stabilize-and-agent-chat' change. When that change archives, skip same-named requirements — these versions are newer. -->

## Requirements

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

### Requirement: Plan CRUD
The system SHALL persist plans and reflect changes immediately in the side panel.

#### Scenario: Create a plan
- **WHEN** the user clicks the create plan button in the Plans section
- **THEN** a new draft plan is created and appears in the "Draft" lane immediately

#### Scenario: Edit a plan
- **WHEN** the user edits a plan via the edit modal and saves
- **THEN** the plan card updates with the new title, description, and goal

#### Scenario: Change plan status
- **WHEN** the user changes a plan's status via the focus modal or card menu
- **THEN** the plan moves to the corresponding status lane in the panel

#### Scenario: Delete a plan
- **WHEN** the user clicks delete on a plan card
- **THEN** the plan is removed from the database and the panel updates immediately

### Requirement: Unified planning inspector
The right side panel's planning surface SHALL present a single inspector with
three tabs — `Plans`, `Ideas`, and `Categories` — over one catalog, replacing
the separate plans-only panel plus disconnected ideas surface. The `Plans` tab
SHALL show plan lanes by status (existing behavior). The `Ideas` tab SHALL list
every idea for the session with a status filter (all / concept / picked /
rejected / archived) and per-idea Promote, Reject, and Delete actions. The
`Categories` tab SHALL list the session's categories and support opening one.
All interactive elements SHALL have `title=` tooltips and 0px radius.

#### Scenario: Switch inspector tabs
- **WHEN** the user selects the `Ideas` or `Categories` tab in the planning
  inspector
- **THEN** the panel shows that view without leaving the side panel, and the
  selected tab persists while the panel is open

#### Scenario: Filter ideas by status
- **WHEN** the user selects a status filter in the `Ideas` tab
- **THEN** only ideas in that status are listed (accepted, rejected, no-change,
  or archived), serving as the planning history

### Requirement: Category drill-down and suggest-more
The `Categories` tab SHALL let the user open a category to view every idea
tagged with it and their statuses, and SHALL provide a "Suggest more ideas"
action that runs category-directed generation for that category. The tab SHALL
also offer "Generate categories" (AI) and "Add category" (manual).

#### Scenario: Open a category
- **WHEN** the user clicks a category in the `Categories` tab
- **THEN** the inspector shows that category's ideas with their statuses and a
  "Suggest more ideas" button scoped to the category

#### Scenario: Suggest more from the category view
- **WHEN** the user clicks "Suggest more ideas" in a category view
- **THEN** category-directed generation runs in the chat transcript and the new
  ideas appear under that category when generation completes

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

### Requirement: Reject affordance on idea cards
Idea cards rendered in the chat transcript SHALL offer a Reject action next to
Promote (and next to any "Generate more" affordance). Rejecting SHALL move the
idea to `rejected` and remove it from the active cards without deleting its
history record.

#### Scenario: Reject from the chat idea card
- **WHEN** the user clicks Reject on a chat idea card
- **THEN** the idea moves to `rejected`, the card is removed from the active
  list, and the idea remains in the inspector's rejected history

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

<!-- Removed: Generate From Context Opens Chat — **Reason**: The `Generate plans` modal is removed. Generation entry points are the chat planning menu and inspector action buttons that launch agentic chat turns; there is no modal routing to replace. -->
<!-- Removed: Context Prompt Composition — **Reason**: Prompt-stuffing composition is superseded by agentic context gathering (`grounded-generation`): the turn reads the schematic and project sources itself, visibly, instead of the app assembling a one-shot prompt from a modal. -->
<!-- Removed: Generate Plans with File Context — **Reason**: The modal and its file-context picker are removed. File context is gathered by the agent through the tool loop during the generation turn. -->
<!-- Removed: Structured plan proposal capture — **Reason**: Superseded by the unified ideas catalog (`unified-planning-workspace`): structured capture writes `ideas` rows rendered as idea cards; there is no separate proposal mechanism. -->
<!-- Removed: Proposal selection state persists — **Reason**: Superseded by the ideas catalog's status history (`concept / picked / rejected / archived`), which persists per session and reloads (`Planning history and catalog access` in `plan-pipeline`). -->
