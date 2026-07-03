# Tasks: Stabilize and Agent Chat

## 1. Bug Fixes - Core Interactions

- [x] 1.1 Fix tab creation: ensure `handleCreateTab` creates terminal tab with PTY and switches to it
- [x] 1.2 Fix tab creation: ensure schematic tab creates and switches to it
- [x] 1.3 Fix file opening: clicking a file in FilesPanel opens a workspace tab with FileViewer
- [x] 1.4 Fix file opening: reusing an already-open file tab focuses it instead of duplicating
- [x] 1.5 Fix plan creation: ensure `createPlan` persists and the panel refreshes
- [x] 1.6 Fix plan editing: ensure `updatePlan` reflects changes in the card immediately
- [x] 1.7 Fix plan status changes: ensure status transitions move the card between lanes
- [x] 1.8 Fix plan deletion: ensure deleted plans disappear from the panel

## 2. Remove Autonomous Toolbar

- [x] 2.1 Delete `AutonomousToolbar.tsx` component
- [x] 2.2 Remove all autonomy props from `WorkspaceTabs.tsx` (autoMode, autoCommit, autoPr, autoGroupPr, autoAgents, onStop)
- [x] 2.3 Remove all autonomy state from `AppShell.tsx` (autoMode, autoCommit, autoPr, autoGroupPr, autoAgents)
- [x] 2.4 Remove autonomy-related CSS from `globals.css`

## 3. Session Context Menus

- [x] 3.1 Add `onContextMenu` handler to session items in `ProjectSidebar.tsx`
- [x] 3.2 Implement session context menu: Rename, Delete
- [x] 3.3 Add Delete confirmation prompt
- [x] 3.4 Add right-click context menu to project items: New Session, Open in Explorer, Hide, Remove

## 4. Generate Plans with File Context

- [x] 4.1 Add "Select context file" button to `GeneratePlanModal.tsx`
- [x] 4.2 Wire file picker to read selected file content
- [x] 4.3 Add file size validation (warn if > 50KB)
- [x] 4.4 Add validation: warn if no schematic and no file selected
- [x] 4.5 Pass file context to the plan generation handler

## 5. Agent Chat - Backend

- [x] 5.1 Define `AgentAdapter` trait in `src-tauri/src/services/agent_service.rs`
- [x] 5.2 Implement `OhMyPiAdapter` that spawns `omp` in interactive mode
- [x] 5.3 Add Tauri commands: `agent_start`, `agent_send`, `agent_stop`
- [x] 5.4 Stream agent output via `agent://output` event
- [x] 5.5 Catch unsupported features and emit error events
- [x] 5.6 Register commands in `lib.rs`

## 6. Agent Chat - Frontend

- [x] 6.1 Add `chat` to `TabKind` type in `sessions.ts` and Rust `TabKind`
- [x] 6.2 Create `ChatPanel.tsx` component with message list and input
- [x] 6.3 Create `src/lib/agent.ts` with `agentStart`, `agentSend`, `agentStop` invoke wrappers
- [x] 6.4 Wire ChatPanel to agent commands and listen for output events
- [x] 6.5 Add "Chat" option to the workspace tab "+" menu
- [x] 6.6 Render chat tab in `AppShell.tsx` workspace area
- [x] 6.7 Add chat-related CSS to `globals.css`

## 7. Cleanup

- [x] 7.1 Add `openspec/` and `.env*` to `.gitignore`
- [x] 7.2 Remove any dead autonomy CSS
- [x] 7.3 Run full build verification (`npm run build`, `cargo check`, `cargo test`)

## 8. Testing

- [ ] 8.1 Verify tab creation (terminal, schematic, chat) works
- [ ] 8.2 Verify file opening from Files panel
- [ ] 8.3 Verify plan CRUD end-to-end
- [ ] 8.4 Verify session context menus
- [ ] 8.5 Verify agent chat sends and receives messages
