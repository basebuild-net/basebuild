# project-chat-sidebar Specification (delta)

## ADDED Requirements

### Requirement: Single global left column
The system SHALL render one persistent left column as the app's only global
navigation surface, with three vertical regions in order: a top action row, a
projects-and-chats list, and a bottom account row. The column SHALL be
collapsible to an icon-only width, and all interactive elements SHALL carry
`title` tooltips.

#### Scenario: Column regions render in order
- **WHEN** the app shell renders
- **THEN** the left column shows the top action row at the top, the
  projects-and-chats list filling the middle, and the account row pinned at the
  bottom

#### Scenario: Collapse to icon-only
- **WHEN** the user activates the collapse toggle in the top action row
- **THEN** the column narrows to icon-only width, the chats list and text labels
  hide, the top action icons and account row stay visible, and tooltips provide
  the labels

### Requirement: Top action row
The top action row SHALL provide `New chat` and `Search` actions and the column
collapse toggle, and SHALL be the primary global action surface (there is no
separate in-app top bar).

#### Scenario: New chat
- **WHEN** the user activates `New chat`
- **THEN** a new chat is created and focused in the center chat surface

#### Scenario: Search
- **WHEN** the user activates `Search`
- **THEN** a search affordance opens for finding projects and chats, including
  chats beyond the per-project recent limit

### Requirement: Projects and chats list with recent limit
The projects-and-chats list SHALL group chats under their project and show at
most the **5 most recent chats per project** by default, with a `Show more` row
per project that reveals the remaining chats for that project.

#### Scenario: Five recent shown
- **WHEN** a project has more than five chats
- **THEN** only the five most recently updated chats are listed under it, plus a
  `Show more` row

#### Scenario: Show more expands one project
- **WHEN** the user activates a project's `Show more` row
- **THEN** the remaining chats for that project are revealed without expanding
  other projects

### Requirement: Chat rows show relative timestamps
Each chat row SHALL display a compact relative timestamp of when it was last
updated, using short units (e.g. `5s`, `1min`, `2h`, `3d`, `1mo`).

#### Scenario: Recent update
- **WHEN** a chat was updated seconds ago
- **THEN** its row shows a seconds-scale label such as `5s`

#### Scenario: Older update
- **WHEN** a chat was last updated over a month ago
- **THEN** its row shows a month-scale label such as `1mo`

### Requirement: Pinning chats
The system SHALL let the user pin and unpin a chat. Pinned chats SHALL appear in
a dedicated section at the top of the list, across all projects, and SHALL NOT
count against the per-project 5-recent limit.

#### Scenario: Pin a chat
- **WHEN** the user pins a chat
- **THEN** it moves into the pinned section at the top of the list and persists
  as pinned across restarts

#### Scenario: Pinned excluded from recent limit
- **WHEN** a chat is pinned
- **THEN** it no longer occupies one of its project's five recent slots

### Requirement: Bottom account row
The bottom of the left column SHALL host the account controls (username /
avatar and settings) and the application update indicator. When an update is
available the indicator SHALL become a one-click install control using the
reserved update-blue CTA color.

#### Scenario: Account controls at bottom-left
- **WHEN** the shell renders
- **THEN** username / avatar and settings are reachable from the bottom of the
  left column, not from any in-app top bar

#### Scenario: Update available
- **WHEN** an app update is detected
- **THEN** the account row shows a blue one-click install control beside the
  avatar
