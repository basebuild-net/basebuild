# Design: Native Chat and Draggable Panes

## Context

Basebuild Desktop has a functional terminal and a minimal chat panel that wraps OMP output. The user wants a real managed chat UI backed by a native OMP PTY layer, with structured message rendering, terminal debug mode (side-by-side), and draggable split panes. The plan generation flow needs to be clearer with three modes and a full idea-to-plan pipeline.

## Goals / Non-Goals

**Goals**:
- Run a native OMP PTY behind each chat tab, with the chat UI rendering structured messages
- Allow switching between "Chat" view and "Terminal" view within a tab
- Add "Terminal Debug" mode showing terminal + chat side-by-side
- Persist chat conversations to the database
- Three-mode plan generation (AI expand, existing schema, from context)
- Support both file and folder context selection
- Draggable split panes for multiple terminals/chats in one tab
- Full idea-to-plan pipeline with model selection

**Non-Goals**:
- Multi-agent orchestration (one agent per chat tab)
- Cloud sync of conversations
- Claude Code / Codex CLI adapter implementations (architecture only)
- Full OMP feature parity (streaming tool calls, file diffs as structured data)

## Architecture

### Native Chat Layer

```
┌─────────────────────────────────────────────┐
│ ChatTab                                      │
│ ┌─────────────┬─────────────────────────┐   │
│ │ ViewToggle  │ [Chat] [Terminal] [Both] │   │
│ ├─────────────┼─────────────────────────┤   │
│ │             │  Chat View:               │   │
│ │  Message    │  - User/assistant msgs    │   │
│ │  List       │  - Action buttons         │   │
│ │             │  - Tool call cards         │   │
│ │             │                           │   │
│ ├─────────────┤  Terminal View:           │   │
│ │  Input      │  - Raw OMP PTY output     │   │
│ │  + Send     │  - xterm.js terminal      │   │
│ └─────────────┴─────────────────────────┤   │
│                                              │
│  Debug Mode: [Terminal | Chat] side-by-side  │
└─────────────────────────────────────────────┘
```

**Backend (Rust)**:
- `AgentManager` already spawns OMP via PTY and streams output via `agent://output` events
- Extend `AgentSession` to store: conversation messages, agent ID, OMP session metadata
- Add `agent_get_messages` command to retrieve persisted conversation
- Add `agent_set_view` command to switch between chat/terminal/debug views (frontend-only, no backend change needed)

**Frontend (React)**:
- `ChatPanel` evolves from a thin listener to a managed UI:
  - Message list with structured rendering (user, assistant, system, tool-call, file-change)
  - Action buttons (approve, deny, retry) — rendered as clickable cards
  - Input box with model selector
  - View toggle: Chat | Terminal | Debug (side-by-side)
- In "Terminal" view, render an xterm.js terminal connected to the same PTY
- In "Debug" view, render terminal + chat side-by-side using a split pane

**Database**:
- New `chat_messages` table: `id, session_id, agent_id, role, content, metadata, created_at`
- Messages are saved as the agent emits output
- On tab restore, messages are loaded from DB

### Draggable Split Panes

**Approach**: Use a pane layout model in the session state:

```typescript
type PaneLayout =
  | { type: "single"; tabId: string }
  | { type: "split"; direction: "horizontal" | "vertical"; panes: PaneLayout[] };
```

**Frontend**:
- `PaneContainer` component renders a tree of panes
- Each leaf pane renders a tab (terminal, chat, file, schematic)
- Drag a tab onto a pane edge → creates a split
- Drag a pane divider → resizes
- Use `react-react` (or custom) for drag handles

**Inspiration from dreamide/dream**:
- Dream uses `panelSizes` per project and `rightPanelOpen` / `chatHistoryPanelOpen` toggles
- Their pane model is: left sidebar (chat history) | center (chat/terminal) | right (files/git)
- We extend this with a split-pane tree that allows arbitrary nesting

### Plan Generation Pipeline

```
Generate Ideas (click)
  → Choose model (e.g., GLM 5.2)
  → Model generates categories
  → Model generates suggestions per category
  → User picks one or more
  → UI updates with pending tasks
  → Show "OpenSpec plan generated" indicator
  → Click "Generate OpenSpec"
  → Choose model (higher intelligence recommended)
  → Plan generated
  → [Autorun checkbox] + [Add to queue] + [Run now]
```

**Backend**:
- `generate_ideas` command: spawns OMP with a system prompt for idea generation, streams output
- `generate_plan_from_idea` command: takes an idea + selected model, spawns OMP to create an OpenSpec plan
- Ideas and plans are linked in the database

## Decisions

### Decision: PTY behind chat, not a separate API
**Rationale**: OMP's interactive mode is the richest interface. Running it via PTY lets us capture all output and also drop to "Terminal" view instantly. No need for a separate REST/gRPC API.
**Alternatives**: Use OMP's `--print` or `--json` mode — rejected because it loses interactivity and tool-use rendering.

### Decision: Structured message rendering with fallback to raw text
**Rationale**: OMP output is raw terminal text with ANSI codes. We parse what we can (messages, tool calls, file changes) and render the rest as preformatted text.
**Alternatives**: Pure raw text — rejected because the user wants buttons and structured UI.

### Decision: Custom split-pane model instead of a library
**Rationale**: The pane layout needs to be persisted and integrated with the tab system. A custom tree model is simpler than fighting a library's API. CSS `resize` + drag handles for dividers.
**Alternatives**: `react-mosaic-component`, `allotment` — rejected for bundle size and inflexibility with custom tab types.

### Decision: Persist chat messages in SQLite
**Rationale**: Already using SQLite for sessions and plans. Conversations should survive restarts.
**Alternatives**: JSON files — rejected because we already have a DB layer.

## Risks / Trade-offs

- **OMP output parsing**: OMP emits ANSI-escaped terminal text, not structured JSON. Parsing may miss or misclassify messages. Mitigation: render unparsed output as raw text in a fallback block.
- **PTY management**: Multiple PTYs (terminals + chats) increase resource usage. Mitigation: limit concurrent agent sessions, lazy-start on first message.
- **Split pane complexity**: Drag-and-drop split panes are complex to implement correctly. Mitigation: start with a simple two-pane side-by-side debug mode, then extend to arbitrary nesting.
- **Plan pipeline is ambitious**: The full idea→plan pipeline depends on OMP's structured output. Mitigation: ship the three-mode modal first, then add the pipeline incrementally.

## Migration Plan

1. Add `chat_messages` table to the database
2. Extend `AgentManager` to persist messages
3. Evolve `ChatPanel` with view toggle and structured rendering
4. Add terminal debug mode (two-pane side-by-side)
5. Implement draggable split panes (start with two-pane, extend later)
6. Wire plan generation three-mode modal (already done on main)
7. Add idea→plan pipeline with model selection

No breaking changes to existing data. All new features are additive.

## Open Questions

- Should the OMP adapter parse ANSI codes or should we add a `--output-format=json` flag to OMP?
- Should split panes support more than two panes per tab, or is two enough for v1?
