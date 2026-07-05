## ADDED Requirements

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
SHALL let the user pick a category (seeded defaults included) before generating.

#### Scenario: Open the planning menu
- **WHEN** the user opens the chat planning menu
- **THEN** it lists `Quick ideas`, `By category…`, and `Open planning
  inspector`, each with a tooltip

#### Scenario: Generate by category from chat
- **WHEN** the user picks a category under `By category…`
- **THEN** category-directed generation runs in the transcript and ideas are
  tagged with the chosen category

### Requirement: Reject affordance on idea cards
Idea cards rendered in the chat transcript SHALL offer a Reject action next to
Promote (and next to any "Generate more" affordance). Rejecting SHALL move the
idea to `rejected` and remove it from the active cards without deleting its
history record.

#### Scenario: Reject from the chat idea card
- **WHEN** the user clicks Reject on a chat idea card
- **THEN** the idea moves to `rejected`, the card is removed from the active
  list, and the idea remains in the inspector's rejected history
