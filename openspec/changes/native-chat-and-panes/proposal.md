# Proposal: Native Chat and Draggable Panes

## Why

The current chat panel is a thin wrapper that listens to OMP output - it can't render structured messages, show action buttons, or manage conversations independently. The plan generation modal is unclear and the context file picker only supports folders. The workspace lacks a side-by-side terminal+chat debug mode, and tabs can't be dragged into split views. The user wants a real managed chat UI backed by a native OMP PTY layer, with the ability to switch between terminal and chat views, and a "terminal debug" mode showing both side-by-side.

## What Changes

### Native OMP Chat Layer
- Run an actual OMP terminal (PTY) behind each chat tab - not just listening to an external terminal
- The chat UI renders structured messages (user, assistant, tool calls, file changes) instead of raw terminal text
- Users can switch between "Chat" view (managed UI) and "Terminal" view (raw OMP) within the same tab
- Chat conversations are persisted to the database and restored on restart
- Add a "Terminal Debug" mode that shows the terminal and chat side-by-side in a single tab

### Plan Generation Improvements
- Three-mode plan generation: (1) Describe & expand with AI, (2) Existing schema (file or folder), (3) From project context
- Context picker supports both files and folders (not just folders)
- Clearer wording: "What is the goal, scope, and pitch of this project?"

### Draggable Split Panes
- Support multiple terminals/chats in a single tab via split views
- Drag tabs to rearrange into side-by-side or stacked layouts
- Inspired by dreamide/dream's multi-pane layout (but using Tauri, not Electron)

### Plan Generation Pipeline
- "Generate ideas → choose model → categories → suggestions → pick → pending tasks → generate openspec → choose model → autorun/queue" pipeline
- Show openspec plan status in the UI
- Model selection with intelligence recommendations

## Capabilities

### New Capabilities
- `native-chat-spec` - Native OMP-backed chat with structured message rendering, terminal debug mode, and conversation persistence
- `plan-generation-spec` - Three-mode plan generation pipeline with model selection and idea-to-plan workflow
- `draggable-panes-spec` - Draggable split-pane workspace with side-by-side terminal+chat views

### Modified Capabilities
- `agent-chat` - Evolved from thin wrapper to native PTY-backed managed chat
- `plan-pipeline-ui` - Three-mode modal, file+folder context picker
