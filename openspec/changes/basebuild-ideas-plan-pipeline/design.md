# Design: Basebuild Ideas and Plan Pipeline

## Context

`basebuild-app` already has project workspaces, terminals, source control, OMP status, and a simple idea category/list UI inside a tab. This change elevates ideas into a persistent **plan pipeline** that owns the right side of the screen and is the primary place the user decides what to work on next.

## Goals / Non-Goals

**Goals**:
- Replace the Ideas tab with a persistent, minimizable **Plan Panel** on the right.
- Reduce the core tools to **Terminal / Source / Plans** (Plans is not a tab - it is a column).
- Move OMP debug/status content into the **Debug** panel.
- Support plan status lifecycle: `draft → openspec → waiting → in_progress → finished` plus `cancelled`.
- Support manual plan creation, AI-enhanced plan editing, AI plan generation, and AI "suggest more" given existing plans.
- Provide a **Focus** modal for an in-progress plan.
- Keep the UI extremely compact and consistent with DESIGN.md.

**Non-Goals**:
- Backend/cloud persistence beyond local SQLite.
- Automatic plan execution queue.
- OpenSpec file creation from plans (prepared for but not implemented).
- Drag-and-drop reordering across lanes (future).

## Decisions

**Decision**: Plans live in SQLite, scoped to the active project/session, not as GitHub Issues or OpenSpec files yet.
- **Rationale**: The user wants fast iteration, sorting, filtering, and AI generation. SQLite is the right home for transient project state. Later, `openspec` status plans can be mirrored to disk.

**Decision**: The right-side panel is a vertical stack of status lanes, not a Kanban board.
- **Rationale**: Vertical lanes pack more information into a narrow column and fit the dense Mono aesthetic. Plans flow downward by status.

**Decision**: Plans have a stable `referenceId` (short alphanumeric) used in terminal/OMP chat interactions.
- **Rationale**: Lets users type or paste `#bb-123` into a terminal or chat to load the plan context.

**Decision**: AI generation uses the existing skill-based prompt flow, not a bespoke model API.
- **Rationale**: Basebuild already owns Basebuild skills; the plan generation skill can be improved independently of the app binary.

**Decision**: "Mark finished" archives a plan into a collapsed pile rather than deleting it.
- **Rationale**: Users want to declutter without losing history. A compact finished pile supports later review.

## Data Model

### Plan

```ts
interface Plan {
  id: string;                    // UUID
  sessionId: string;             // owning session
  referenceId: string;           // short human-readable id, e.g. "bb-a7f"
  title: string;
  description: string;
  goal?: string;                 // optional final/project goal this plan contributes to
  status: PlanStatus;
  priority: number;              // 0-100, AI-generated then manually editable
  tags: string[];                // e.g. ["mvp", "ui", "rust"]
  context?: PlanFocusContext;    // focus mode notes / last files seen
  aiEnhanced: boolean;           // true if description was rewritten by AI
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
}

type PlanStatus =
  | "draft"
  | "openspec"
  | "waiting"
  | "in_progress"
  | "finished"
  | "cancelled";

interface PlanFocusContext {
  notes: string;
  files: string[];
  terminalOutputTail?: string;
}
```

## UI Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ Window taskbar                                                       │
├──────────┬──────────────────────────────────────────┬───────────────┤
│ Projects │ Workspace (Terminal or Source)             │ Plans Panel   │
│ sidebar  │                                            │ (minimizable) │
│          │                                            │               │
│          │                                            │ [+ Plan]      │
│          │                                            │ [Generate ▾]  │
│          │                                            │               │
│          │                                            │ IN PROGRESS   │
│          │                                            │ · Plan A      │
│          │                                            │ · Plan B      │
│          │                                            │               │
│          │                                            │ WAITING       │
│          │                                            │ · Plan C      │
│          │                                            │               │
│          │                                            │ DRAFT         │
│          │                                            │ · Plan D      │
│          │                                            │               │
│          │                                            │ FINISHED ▼    │
│          │                                            │               │
└──────────┴──────────────────────────────────────────┴───────────────┘
```

## Plan Panel Components

- `PlanPanel` - right-side column, minimizable, renders lanes.
- `PlanLane` - vertical section for one status with count badge and subtle animation on add/remove.
- `PlanCard` - compact card with title, reference id, priority dots, status actions.
- `PlanModal` - edit/create/focus mode for a single plan.
- `GeneratePlansModal` - goal input, model selector (optional), generate button, preview list.
- `FocusActions` - Copy reference id / Open in terminal / Open in OMP / Mark finished / Cancel.

## Interactions

1. **Generate Plans**:
   - Click the generate button.
   - Modal shows the current project goal (default equals project name or user-set target).
   - User can edit the goal.
   - AI skill returns prioritized plans with `draft` status.
   - User approves all or selects a subset; approved plans save to SQLite.

2. **Suggest More Plans**:
   - Same flow, but the prompt includes existing active plans + the original goal.
   - Returned plans are appended as `draft`.

3. **Create Task**:
   - Opens a compact inline or modal form.
   - User enters title/description.
   - Optional **AI Enhance** rewrites/extends and tags the plan before save.

4. **Focus Plan** (for `in_progress`):
   - Modal shows title, description, reference id, status, notes, files.
   - Actions:
     - **Copy reference** - copies `#bb-xyz` to clipboard.
     - **Open in terminal** - creates/opens a terminal and injects the reference.
     - **Open in OMP** - (future prep) creates an OMP tab focused on this plan.
     - **Mark finished** - moves to finished pile.
     - **Cancel** - status `cancelled`.

5. **Status Transitions**:
   - `draft` → `openspec` → `waiting` → `in_progress` → `finished`
   - Any non-finished status can move backward or to `cancelled`.
   - Plans in `finished` or `cancelled` collapse into the **Finished** pile.

## Migration Plan

1. Add `referenceId`, `goal`, `priority`, `tags`, `status` enum, `context`, `aiEnhanced`, `finishedAt` to the Rust `Plan` model and SQLite schema.
2. Add Rust CRUD commands for plans and status transitions.
3. Build the right-side `PlanPanel` and replace the Ideas tab with it.
4. Update the main layout to remove OMP from the tool rail and re-add OMP status inside `DebugPanel`.
5. Add plan generation skills and frontend flows.
6. Update AGENTS.md/DESIGN.md references.
7. Visually verify the new three-column layout.

## Open Questions

- Should `openspec` status plans auto-link to an OpenSpec change on disk, or remain a manual user action?
- Should finished plans be retained forever, or auto-purged after N days?
- Should the plan panel remember minimization per project or globally?
