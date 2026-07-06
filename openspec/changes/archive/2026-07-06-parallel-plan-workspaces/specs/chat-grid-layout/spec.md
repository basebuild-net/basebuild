## ADDED Requirements

### Requirement: Multi-chat grid container
The system SHALL render a workspace chat tab as a grid container holding zero or more chat columns side-by-side, where each column is a fully independent chat session with its own header, conversation, and composer. The grid SHALL support `1×N` (single row, N chats) and `M×N` (M rows, N columns) layouts with no fixed maximum on M or N beyond available viewport space.

#### Scenario: Single chat in a tab
- **WHEN** a chat tab is created via "+" → Chat and no other chats are open in that tab
- **THEN** the grid renders one chat column filling the tab's content area, with no splitters visible

#### Scenario: Add a second chat beside the first
- **WHEN** the user invokes "Add chat beside" from the active chat's header menu while one chat is visible
- **THEN** the grid splits into a `1×2` layout with a draggable splitter between the two columns, and the new chat column receives focus

#### Scenario: Multi-row grid
- **WHEN** the user adds a fifth chat to a `1×4` row that is already at the viewport's column cap
- **THEN** the grid wraps to a `2×3` (or nearest fitting M×N) layout, with a horizontal splitter between rows and vertical splitters between columns in each row

#### Scenario: No fixed grid cap
- **WHEN** the user adds chats up to a `3×3` layout (9 chats)
- **THEN** all nine chats render in the grid without error, and the layout remains interactive (splitters draggable, each chat independently scrollable and operable)

### Requirement: Per-chat column resize
The system SHALL let the user drag splitters between adjacent chat columns (and between adjacent rows in an M×N layout) to resize them, with each column's width clamped to a defined minimum so no chat collapses below its composer/input minimum height or its control rail's narrowest usable width.

#### Scenario: Drag a vertical splitter
- **WHEN** the user drags the splitter between two chats in a `1×2` layout to the right
- **THEN** the right chat's width decreases and the left chat's width increases by the same delta, the right chat never shrinks below its minimum width, and the drag has no effect on chats in other rows

#### Scenario: Minimum width enforced
- **WHEN** the user drags a splitter until the right chat would shrink below `CHAT_PANEL_MIN_WIDTH_PX`
- **THEN** the splitter stops moving in that direction and the right chat's width stays at the minimum

#### Scenario: Row height resize
- **WHEN** the user drags a horizontal splitter between two rows in a `2×2` layout
- **THEN** the upper row's height decreases and the lower row's height increases by the same delta, with each row clamped to a minimum height that keeps its chats' composers visible

### Requirement: Chat column reorder
The system SHALL let the user reorder chat columns within a row by dragging a chat's header, with live position feedback and a clear drop target. Reordering across rows is supported and moves the chat to the target row at the drop index.

#### Scenario: Drag chat to swap positions
- **WHEN** the user drags chat A's header from position 0 over chat B at position 1 in a `1×2` grid
- **THEN** chat A and chat B swap positions once the drag passes the drag threshold, the active chat follows the drag, and the grid layout widths are unchanged

#### Scenario: Drag across rows
- **WHEN** the user drags a chat from row 1, position 0 to row 2, position 1 in a `2×2` grid
- **THEN** the chat moves to row 2 at index 1, the source row reflows, and the destination row's widths rebalance to fit the new column count

#### Scenario: Click without drag does not reorder
- **WHEN** the user mouse-downs on a chat header and releases without moving past the drag threshold
- **THEN** the chat is activated (focused) but its position in the grid is unchanged

### Requirement: Close chat column with animation
The system SHALL animate a chat column out of the grid when closed: the column collapses to zero width with a short transition, neighboring columns rebalance to fill the freed space, and the closed chat's session is retained for history (not deleted) unless the user explicitly confirms deletion.

#### Scenario: Close one of three chats
- **WHEN** the user closes chat B in a `1×3` grid (chats A, B, C)
- **THEN** chat B animates to zero width, chats A and C expand to fill the row, the focus moves to chat C (the next chat to the right), and chat B's session remains in the project's session history

#### Scenario: Close the last chat in a tab
- **WHEN** the user closes the only remaining chat in a chat tab
- **THEN** the grid shows an empty state prompting "Start a chat" or "Close tab"; the tab itself is not auto-closed

### Requirement: Grid layout persistence
The system SHALL persist, per workspace tab, the grid's chat membership (`openChatIds` in display order), per-column widths (`chatColumnWidths`), and row layout, restoring them when the tab is reactivated or the app is restarted. Restored widths that no longer fit the viewport (e.g. window shrunk) SHALL be clamped to fit before render.

#### Scenario: Reopen a tab with a 1×3 grid
- **WHEN** the user switches away from a chat tab holding a `1×3` grid (chats A, B, C with widths 480, 320, 400) and switches back
- **THEN** the grid restores with chats A, B, C in that order with widths 480, 320, 400 (clamped if the viewport is now narrower)

#### Scenario: Restart preserves the grid
- **WHEN** the app is closed and reopened on a project whose last active tab held a `2×2` grid
- **THEN** the four chats rehydrate in their saved positions and widths, with stale chat sessions (whose backing processes are gone) shown in a disconnected state, not auto-respawned

#### Scenario: Width clamping on restore
- **WHEN** a stored column width plus the minimum widths of its row-mates exceeds the current viewport width
- **THEN** the columns are rebalanced proportionally to fit the viewport before the first paint, never producing an overflow scrollbar on the grid container

### Requirement: Tab-scoped grid isolation
Each workspace tab SHALL hold an independent grid. Switching tabs SHALL not affect the grid state (chat set, widths, order) of any other tab. A chat session referenced by one tab's grid MAY be referenced by another tab's grid; both views render the same conversation but operate on their own focus and width state.

#### Scenario: Two tabs, two layouts
- **WHEN** tab A holds a `1×2` grid (chats X, Y) and tab B holds a `1×3` grid (chats P, Q, R)
- **THEN** switching from tab A to tab B renders tab B's `1×3` grid unchanged, and switching back to tab A renders its `1×2` grid unchanged

#### Scenario: Same chat in two tabs
- **WHEN** the user opens chat X in tab A's grid and also opens chat X in tab B's grid
- **THEN** both tabs render chat X's conversation; sending a message in one updates the other if both are mounted, and each tab tracks its own scroll position and composer draft independently

### Requirement: Plan-run chat appears in the active grid
When a plan run auto-provisions a chat session (per the `plan-run-queue` and `plan-chat-assignment` specs), the system SHALL surface that chat in the active chat tab's grid (creating a new chat tab if none is active), so the user can watch the run alongside their other work without manually navigating to it.

#### Scenario: Plan run starts while a chat tab is active
- **WHEN** a plan starts and the active workspace tab is a chat tab with a `1×1` grid
- **THEN** the plan's auto-provisioned chat (`bb-<ref> — <title>`) is added as a new column, producing a `1×2` grid, and the new chat receives focus

#### Scenario: Plan run starts with no chat tab active
- **WHEN** a plan starts and the active tab is a terminal or schematic tab
- **THEN** a new chat tab is created with the plan's chat as its single-column grid, and the new tab becomes active

#### Scenario: Plan run chat follows the same close rules
- **WHEN** the user closes a plan-run chat column in the grid
- **THEN** it animates out like any other chat column and the plan's run state is unaffected (closing the chat view does not cancel the run)
