# desktop-shell Specification

## MODIFIED Requirements

### Requirement: Atomic project activation surface
The system SHALL treat project selection as a generation-guarded activation transaction and SHALL render a project loading surface before any project-scoped session, panel, planning, provider/model, or source state is shown. Content from the prior project SHALL be removed immediately; late responses from prior generations SHALL be ignored. Partial failure SHALL identify the failing subsystem and offer retry without exposing stale data.

#### Scenario: Rapid project switching settles only the final project
- **WHEN** the user selects projects A, B, and C before A or B finishes restoring
- **THEN** the shell paints loading feedback immediately, commits only C's state, and never shows an A/B chat, model, count, path, or warning under C

#### Scenario: A restore subsystem fails
- **WHEN** project detection succeeds but provider/model restore fails
- **THEN** the loading surface identifies provider/model restore as failed, offers retry, and does not reuse the previous project's provider/model

### Requirement: Single-flight folder selection
The system SHALL allow at most one native project-folder picker at a time across all entry points and SHALL expose the in-flight state on every folder trigger until the picker resolves or is cancelled.

#### Scenario: Folder action is invoked repeatedly
- **WHEN** the folder action is invoked several times before the native picker resolves
- **THEN** one native picker exists, later invocations are logged as skipped, and cancel returns the shell to its prior project without an error

### Requirement: Viewport-safe compact navigation
The system SHALL keep account menus, context menus, dialog actions, and required chat/workspace context fully visible and keyboard reachable at the supported 960×640 minimum and common Windows scale factors. Popovers SHALL flip or clamp at viewport edges rather than render off-screen.

#### Scenario: Bottom-left account menu opens at minimum size
- **WHEN** the app is 960×640 at 150% scale and the user opens the bottom-left account menu
- **THEN** the entire menu, Settings action, and Sign out action are visible within the viewport and reachable by keyboard
