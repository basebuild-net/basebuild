# Spec Delta: desktop-shell

## ADDED Requirements

### Requirement: Startup Workspace Splash

The system SHALL show a startup splash overlay immediately on app launch that covers the workspace restore window between the update gate (or dev-mode launch) and the interactive shell. The splash SHALL display the app name, version, and a phase label reflecting the current restore pipeline stage. The splash SHALL dismiss with a fade transition when all restore subsystems have resolved or failed.

#### Scenario: App launches and shows splash
- **WHEN** the app launches (dev mode or post-update-gate)
- **THEN** a splash overlay paints within the first frame showing the app name, version, and "Starting up…" label, and the main shell is not interactive until the splash dismisses

#### Scenario: Splash shows restore phase
- **WHEN** the workspace restore pipeline progresses through restore, project detection, and provider resolution
- **THEN** the splash label updates to reflect the current phase ("Restoring workspace…", "Detecting projects…", "Resolving providers…")

#### Scenario: Splash dismisses on ready
- **WHEN** all restore subsystems resolve or fail
- **THEN** the splash fades out (200ms opacity transition) and is removed from the DOM, revealing the interactive shell

### Requirement: Project-Switch Transition State

The system SHALL render an immediate transition state in the main view when the user selects a different project, before any restore subsystem resolves. The transition state SHALL show a loading indicator and the target project name. The prior project's content SHALL be removed from the main view immediately when the transition state renders.

#### Scenario: User clicks a different project
- **WHEN** the user clicks a project in the left column that is not the active project
- **THEN** the main view immediately shows a transition overlay with the target project name and a loading indicator, and the prior project's panels are no longer visible

#### Scenario: Switch completes
- **WHEN** the target project's restore subsystems resolve
- **THEN** the transition overlay is removed and the target project's panels are rendered in the main view

#### Scenario: Rapid switching settles on final target
- **WHEN** the user clicks projects A, B, and C in rapid succession
- **THEN** the transition overlay updates to show each target name, and only C's panels are rendered when its restore completes

### Requirement: Left Column Repo Identity

The system SHALL display git repo identity in each project row in the left column: a host favicon (GitHub, GitLab, Bitbucket, or generic git), the repo name (last path segment), and the current branch name. Non-git projects SHALL show a folder icon and the path. Favicons SHALL be bundled SVG assets with no network fetch.

#### Scenario: Git project shows repo identity
- **WHEN** the left column renders a project that is a git repository with a GitHub remote
- **THEN** the project row shows the GitHub favicon, the repo name (last path segment), and the current branch name

#### Scenario: Non-git project shows folder identity
- **WHEN** the left column renders a project that is not a git repository
- **THEN** the project row shows a folder icon and the project name, with no branch label

#### Scenario: Self-hosted git shows generic icon
- **WHEN** the left column renders a git project whose remote host is not GitHub, GitLab, or Bitbucket
- **THEN** the project row shows a generic git icon and the repo name

### Requirement: All Projects Visible In Left Column

The system SHALL show all known projects as rows in the left column without folding or collapsing. The active project SHALL be highlighted; inactive projects SHALL be dimmed but visible and clickable. Sessions SHALL remain expandable per-project.

#### Scenario: Multiple projects all visible
- **WHEN** the left column renders with three known projects
- **THEN** all three project rows are visible without expanding, the active project is highlighted, and the inactive projects are dimmed but clickable

#### Scenario: Sessions expand per-project
- **WHEN** the user clicks a project's session chevron
- **THEN** that project's sessions expand or collapse without affecting the visibility of other project rows

### Requirement: Agent Status Indicators In Left Column

The system SHALL display an agent status indicator (animated dot) in each project row that reflects the real-time state of that project's agent sessions. The indicator SHALL show: running (pulsing), questioning (bouncing), standby (solid), or idle (hollow). Animations SHALL be CSS-only.

#### Scenario: Running agent shows pulsing dot
- **WHEN** a project has an active agent turn in flight
- **THEN** the project row shows a pulsing green status dot

#### Scenario: Questioning agent shows bouncing dot
- **WHEN** a project's agent has a pending question or approval interaction
- **THEN** the project row shows a bouncing amber status dot

#### Scenario: Standby agent shows solid dot
- **WHEN** a project has an idle agent session with no in-flight turn or pending interaction
- **THEN** the project row shows a solid blue status dot

#### Scenario: No session shows hollow dot
- **WHEN** a project has no agent session
- **THEN** the project row shows a hollow gray status dot

### Requirement: History And Plans Are Project-Scoped

The system SHALL scope the history drawer and planning inspector to the active project. The history drawer SHALL show only panels belonging to the active project. The left column SHALL NOT duplicate plan or history lists as global lists.

#### Scenario: History drawer scoped to active project
- **WHEN** the user opens the history drawer while project A is active
- **THEN** the history drawer shows only panels from project A, not from other projects

#### Scenario: Switching projects updates history
- **WHEN** the user switches from project A to project B and opens the history drawer
- **THEN** the history drawer shows only panels from project B
