## MODIFIED Requirements

### Requirement: Viewport-safe compact navigation
The system SHALL keep account menus, context menus, dialog actions, required chat/workspace context, and bottom-right zoom/status controls fully visible and keyboard reachable at the supported 960×640 minimum and common Windows scale factors. Popovers SHALL flip or clamp at viewport edges rather than render off-screen. The persistent left navigation SHALL contain only Projects, Chats, Settings, and Updates surfaces; plans, ideas, files, source, and flow controls SHALL move to chat affordances or project modals.

#### Scenario: Bottom-left account menu opens at minimum size
- **WHEN** the app is 960×640 at 150% scale and the user opens the bottom-left account menu
- **THEN** the entire menu, Settings action, and Sign out action are visible within the viewport and reachable by keyboard

#### Scenario: Left side is decluttered
- **WHEN** the left sidebar renders
- **THEN** it shows Projects, Chats, Settings, and Updates only, with no persistent Plan/Ideas/Files/Source/Flow entries

#### Scenario: Planning remains reachable
- **WHEN** the user needs ideas, plans, OpenSpec changes, run board, or final touches
- **THEN** those surfaces open from chat controls, context strip/header actions, Settings, or project modals rather than permanent left-side clutter

### Requirement: Panel Creation Affordances
The global plus button, chat/sidebar new-panel controls, panel-header split controls, file-open actions, schematic actions, history re-open, prompt routing, and plan-run events SHALL use the same checked panel insertion behavior. Each interactive action SHALL either create/focus the requested visible panel exactly once or show an actionable error; closing a menu without a visible result SHALL NOT be treated as success. Primary add/new-chat affordances SHALL be visually large enough to discover in the simplified shell.

#### Scenario: Header menu and sidebar are consistent
- **WHEN** the user creates the same panel type from the header plus menu or the sidebar
- **THEN** both affordances apply the same anchor resolution, pending state, focus, error, and cleanup behavior

#### Scenario: Process-backed option cannot disappear silently
- **WHEN** the user chooses Terminal, OMP, or OpenSpec run and panel insertion or process startup fails
- **THEN** the shell shows the failure, leaves the existing workspace usable, and does not retain an unreachable process-backed tab

#### Scenario: Plus action is discoverable
- **WHEN** the shell is in normal or compact mode
- **THEN** the primary `+`/new-chat action is visible, has a tooltip, and opens a simple flat menu with no unrelated planning clutter
