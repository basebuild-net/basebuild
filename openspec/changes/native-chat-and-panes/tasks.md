# Tasks: Native Chat and Draggable Panes

## 1. Database — Chat Message Persistence

- [ ] 1.1 Add `chat_messages` table: `id TEXT PK, session_id TEXT FK, agent_id INTEGER, role TEXT, content TEXT, metadata TEXT, created_at INTEGER`
- [ ] 1.2 Add migration to `storage_service.rs` for `chat_messages` table
- [ ] 1.3 Add `save_chat_message` command
- [ ] 1.4 Add `list_chat_messages` command (by session_id)
- [ ] 1.5 Add `delete_chat_messages` command (by session_id, for clearing a conversation)
- [ ] 1.6 Register commands in `lib.rs`

## 2. Backend — Agent Manager Enhancements

- [ ] 2.1 Extend `AgentSession` struct to store `session_id` for DB persistence
- [ ] 2.2 Add `agent_get_messages` command that loads messages from DB
- [ ] 2.3 Modify `agent_start` to accept a `session_id` parameter for linking to DB
- [ ] 2.4 Parse OMP output into structured message types (user, assistant, tool-call, file-change, raw)
- [ ] 2.5 Persist each parsed message to `chat_messages` table as it arrives
- [ ] 2.6 Emit structured message events (`agent://message` with `{role, content, metadata}`) alongside raw `agent://output`

## 3. Frontend — Chat Panel Evolution

- [ ] 3.1 Add view toggle to ChatPanel: [Chat] [Terminal] [Debug]
- [ ] 3.2 In "Chat" view, render structured messages from `agent://message` events
- [ ] 3.3 In "Terminal" view, render an xterm.js terminal connected to the same agent PTY
- [ ] 3.4 In "Debug" view, render terminal + chat side-by-side using a flex split
- [ ] 3.5 Add message types: user, assistant, system, tool-call, file-change, raw-fallback
- [ ] 3.6 Add action buttons for tool calls (approve, deny, retry) — rendered as cards
- [ ] 3.7 Add model selector dropdown in the chat header
- [ ] 3.8 Load and display persisted messages on chat tab restore
- [ ] 3.9 Add "Clear conversation" button that deletes messages from DB and clears the UI

## 4. Frontend — Terminal Debug Mode

- [ ] 4.1 Implement a `SplitPane` component with a draggable divider
- [ ] 4.2 Render terminal (xterm.js) in the left pane and chat in the right pane
- [ ] 4.3 Ensure both panes receive the same `agent://output` events
- [ ] 4.4 Allow typing in both the terminal pane and the chat input
- [ ] 4.5 Resize the xterm.js terminal when the divider is dragged

## 5. Frontend — Draggable Split Panes

- [ ] 5.1 Define `PaneLayout` type: single | split (horizontal/vertical) with child panes
- [ ] 5.2 Create `PaneContainer` component that renders a `PaneLayout` tree
- [ ] 5.3 Add drag-and-drop: drag a tab onto a pane edge → create a split
- [ ] 5.4 Add draggable dividers between panes for resizing
- [ ] 5.5 Add pane close: closing a tab in a split collapses the split
- [ ] 5.6 Persist pane layout to the `session_tabs` table as JSON metadata
- [ ] 5.7 Restore pane layout on app restart

## 6. Plan Generation — Three-Mode Modal

- [x] 6.1 Redesign GeneratePlanModal with three modes (AI expand, existing schema, from context)
- [x] 6.2 Add `pick_context_file` command supporting file selection
- [x] 6.3 Add `pick_context_folder` command supporting folder selection
- [x] 6.4 Wire "Existing schema" mode to file/folder picker
- [x] 6.5 Update modal wording: "What is the goal, scope, and pitch of this project?"

## 7. Plan Generation — Idea-to-Plan Pipeline

- [ ] 7.1 Add "Generate ideas" button in the Ideas panel
- [ ] 7.2 Add model selector dropdown (fetches available OMP models via `omp_status`)
- [ ] 7.3 Add `generate_ideas` command that spawns OMP with idea-generation system prompt
- [ ] 7.4 Parse OMP output into idea categories and suggestions
- [ ] 7.5 Render ideas as selectable cards in the UI
- [ ] 7.6 Add "Generate OpenSpec" button on selected ideas
- [ ] 7.7 Add model selector for plan generation (recommend higher intelligence)
- [ ] 7.8 Add `generate_plan_from_idea` command that spawns OMP to create a plan
- [ ] 7.9 Add "Autorun" checkbox with model selector on generated plans
- [ ] 7.10 Add "Add to queue" and "Run now" buttons on generated plans

## 8. Testing

- [ ] 8.1 Test chat tab creation, message send/receive, and persistence
- [ ] 8.2 Test view toggle: Chat → Terminal → Debug → Chat
- [ ] 8.3 Test terminal debug mode shows both panes correctly
- [ ] 8.4 Test split pane: create split, resize, close pane
- [ ] 8.5 Test plan generation modal: all three modes work
- [ ] 8.6 Test context file picker: both file and folder selection
- [ ] 8.7 Test idea-to-plan pipeline end-to-end
- [ ] 8.8 Test conversation restore after restart
- [ ] 8.9 Test pane layout restore after restart
- [ ] 8.10 Run full build verification (npm run build, cargo check, cargo test)
