# Design: OpenSpec Chat Workbench

## Context

PR #26 reports 35/35 MVP hardening tasks complete: project activation, compact shell, questionnaire-first routing, plan readiness controls, dependency-aware workers, run board, merge queue, and tests. The follow-up comment on PR #26 also identifies credential-management gaps, but those are adjacent and not part of this change unless needed for reliable chat setup.

The user direction for this change is product scope correction:

- Basebuild is a **wrapper/control plane around OpenSpec and OMP**, not an independent planning framework.
- Native chat should generate ideas, ask questions, and route decisions; OpenSpec owns artifacts, implementation tasks, apply, verify, and archive/sync.
- The UI should look and feel like a modern agent chat/IDE: flat, simple, dark, vibrant statuses, real Markdown/code rendering, visible thinking, visible tool calls, clickable choices, and per-chat workspace context.
- Lower-intelligence/slower models will implement this. Tasks must name files, include snippets, and avoid ambiguous architectural choices.

Reference-app finding:

- The referenced Dream IDE repository is MIT and exposes useful concepts: multi-project workspace, multiple chats, git branch/status, file/diff/editor surfaces, terminal, and browser preview. Current Basebuild already contains comments directly naming that reference in `ChatHeader.tsx` and docs.
- The corrected T3 Code repository is `pingdotgg/t3code`; GitHub reports MIT License, and `LICENSE` confirms MIT copyright `T3 Tools Inc.`. Its README describes a minimal web GUI for coding agents (Codex, Claude, Cursor, OpenCode), and its docs describe a Node/WebSocket server that wraps provider runtimes, normalizes provider events, and pushes ordered typed events to React. Its `.plans/branch-environment-picker-in-chatview-input.md` is directly relevant: a toolbar under the chat input shows environment mode (`Local` / `New worktree`) and branch, locks environment mode after the first message, and hides for non-git projects.
- MIT allows copying with notice, but the requested product direction says no direct references to external codebases except intentional modules such as OMP/OpenSpec. Therefore this design chooses **clean-room implementation from observed product patterns**, and removes direct reference comments from shipped code/docs. If future work copies substantial source, it must be vendored as a module with license notice; otherwise do not copy.

## Goals / Non-Goals

**Goals**:

- Make OpenSpec the only implementation-plan/artifact source for MVP planning runs.
- Add Settings → OpenSpec install/update/health UI and backend commands.
- Render agent activity as chronological rows, not grouped tool-call lumps.
- Render thinking as split timeline blocks when tool calls/questions interrupt it.
- Show all runtime/workspace/plan/context metadata in each chat without crowding.
- Provide clickable question/choice UI for native, OMP RPC, and prose fallback.
- Modernize the shell and design tokens while preserving 0px radius, one stylesheet, and local-first behavior.
- Add zoom controls and a visible zoom indicator.
- Update `DESIGN.md`, docs, and `mvp.md` to match the new MVP loop.

**Non-Goals**:

- No provider credential fix from PR #26 follow-up unless discovered as a blocker during implementation.
- No new cloud service, analytics upload, or remote sync.
- No direct port of external app code unless handled as a licensed module boundary.
- No second native planning artifact format beyond OpenSpec pointers/progress metadata.

## Decisions

### Decision: OpenSpec owns artifacts and implementation tasks

**Decision**: Plans promoted from ideas use `engine: openspec`; `.basebuild` stores metadata, execution profile, validation state, and an `external` pointer to `openspec/changes/<slug>/`.

**Rationale**: Existing specs already define OpenSpec artifact generation and import. Duplicating task lists creates drift and makes low-intelligence agents choose the wrong source.

**Implementation snippet**:

```ts
// src/lib/plans.ts — shape only; keep lib as invoke wrapper.
export type PlanExternalRef = {
  engine: "openspec";
  changeName: string;
  path: string; // openspec/changes/<changeName>/
};

export type PlanExecutionContext = {
  planId: string;
  engine: "openspec";
  external: PlanExternalRef;
  providerId: string | null;
  modelId: string | null;
  effort: string | null;
  workspacePolicy: "worktree" | "primary";
};
```

Opening prompt for assigned OpenSpec runs should be short and path-based:

```text
You are applying the OpenSpec change at openspec/changes/<change-name>/.
Read proposal.md, design.md if present, specs/**/spec.md, and tasks.md.
Work tasks.md top-to-bottom. Mark each checkbox immediately after completing it.
Do not create a second implementation plan. Update docs/DESIGN/mvp only where tasks.md says so.
Run the relevant verification commands before reporting completion.
```

### Decision: Planning Command Center is visual-first

**Decision**: `PlanningInspector.tsx` / Flow view becomes the visual command center for the MVP loop. It shows stage cards and counts for Ideas, OpenSpec, Ready, Queued, Running, Blocked, Review, Finished, and Integration. Every card shows a status word, color, count, current activity, and the next click action.

**Rationale**: The owner wants to see “how many are going” and quickly add more or run an idea through OpenSpec. Raw rows and hidden menus make the workflow feel inert.

**Implementation snippet**:

```tsx
type CommandCenterStage = {
  id: "ideas" | "openspec" | "ready" | "queued" | "running" | "blocked" | "review" | "finished";
  label: string;
  count: number;
  status: "idle" | "active" | "blocked" | "success" | "warning";
  actionLabel: string;
};

function PlanningCommandCenter({ stages }: { stages: CommandCenterStage[] }) {
  return (
    <div className="planning-command-center" title="Planning command center">
      {stages.map((stage) => (
        <button
          key={stage.id}
          type="button"
          className={`planning-stage-card is-${stage.status}`}
          title={`${stage.label}: ${stage.count}. ${stage.actionLabel}`}
        >
          <span className="planning-stage-count">{stage.count}</span>
          <span className="planning-stage-label">{stage.label}</span>
          <span className="planning-stage-action">{stage.actionLabel}</span>
        </button>
      ))}
    </div>
  );
}
```

Add visible primary actions near the stage cards:

```tsx
<button className="btn btn-primary" title="Generate more grounded ideas">+ Generate ideas</button>
<button className="btn" title="Run selected idea through OpenSpec">Run through OpenSpec</button>
<button className="btn" title="Add another worker chat">+ Add worker</button>
```

### Decision: Activity timeline rows, no grouping by default

**Decision**: Replace `ToolEventGroup` as the default transcript renderer with a flat ordered timeline. Keep any compact grouping only behind a future user setting.

**Rationale**: The owner explicitly wants no lumps/grouping and wants thinking/tool calls split in a timeline. Existing `ToolEventGroup` hides sequence and makes low-intelligence agents harder to monitor.

**Implementation snippet**:

```ts
// src/components/panels/ChatPanel.tsx
// Replace grouped rendering with a sequence-preserving item list.
type ChatActivityItem =
  | { type: "thinking"; id: string; sequence: number; text: string; status: "running" | "done" }
  | { type: "assistant_text"; id: string; sequence: number; markdown: string; status: "running" | "done" }
  | { type: "tool_call"; id: string; sequence: number; event: NativeToolEvent }
  | { type: "question"; id: string; sequence: number; interaction: PendingInteraction }
  | { type: "notice" | "error" | "approval" | "capture"; id: string; sequence: number; summary: string; detail?: string };

function ActivityTimeline({ items }: { items: ChatActivityItem[] }) {
  return (
    <div className="activity-timeline" title="Agent activity timeline">
      {items.sort((a, b) => a.sequence - b.sequence).map((item) => (
        <ActivityTimelineRow key={item.id} item={item} />
      ))}
    </div>
  );
}
```

Split thinking whenever another activity arrives:

```ts
function appendThinking(delta: string) {
  setActivity((prev) => {
    const last = prev.at(-1);
    if (last?.type === "thinking" && last.status === "running") {
      return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
    }
    return [...prev, newThinkingItem(delta)];
  });
}

function appendToolCall(event: NativeToolEvent) {
  setActivity((prev) => [
    ...closeOpenThinking(prev),
    { type: "tool_call", id: event.id, sequence: nextSequence(), event },
  ]);
}
```

### Decision: Questions are inline timeline blockers

**Decision**: `QuestionCard` remains the answer UI, but it renders as a timeline row and every agent A/B/options prompt has clickable affordances.

**Rationale**: Existing `chat-interactive-elements` already defines the contract. This change enforces it across all agent conversations and degraded prose messages.

**Implementation snippet**:

```tsx
function ActivityTimelineRow({ item }: { item: ChatActivityItem }) {
  if (item.type === "question") {
    return <QuestionCard interaction={item.interaction} />;
  }
  if (item.type === "tool_call") {
    return <ToolEventCard event={item.event} />;
  }
  if (item.type === "thinking") {
    return <ThinkingBlock text={item.text} status={item.status} />;
  }
  return <MarkdownMessage markdown={item.markdown ?? item.summary} />;
}
```

### Decision: Per-chat context strip under/near composer

**Decision**: Header stays minimal; a context strip under the input carries full workspace context: workspace id, branch, worktree, OpenSpec change, plan progress, queue state, model, context meter, and zoom/status indicator.

**Rationale**: The owner asked for branch/worktree/plan/progress under each chat input. Header-only metadata already gets crowded.

**Implementation snippet**:

```tsx
// src/components/panels/ChatContextStrip.tsx
export type ChatContextStripProps = {
  workspaceId: string | null;
  branch: string | null;
  worktreePath: string | null;
  plan: { referenceId: string; title: string; status: string; changeName?: string } | null;
  progress: { completed: number; total: number; phase?: string } | null;
  runState: "idle" | "queued" | "running" | "blocked" | "finished" | "failed";
  modelLabel: string;
  contextUsage: { used: number | null; limit: number | null };
};

export function ChatContextStrip(props: ChatContextStripProps) {
  return (
    <div className="chat-context-strip" title="Chat workspace and plan context">
      <ContextChip label="branch" value={props.branch ?? "no git"} />
      {props.worktreePath ? <ContextChip label="worktree" value="isolated" title={props.worktreePath} /> : null}
      {props.plan ? <ContextChip label="plan" value={`${props.plan.referenceId} ${props.plan.status}`} /> : null}
      {props.progress ? <ContextChip label="tasks" value={`${props.progress.completed}/${props.progress.total}`} /> : null}
      <ContextMeter usage={props.contextUsage} />
    </div>
  );
}
```

T3 Code branch/environment pattern adapted without copying source:

```tsx
// Basebuild version: under-input context strip, not a copied component.
// Environment policy locks once the first OpenSpec run starts; branch remains
// changeable through explicit branch/worktree actions.
const canChangeWorkspacePolicy = messageCount === 0 && !assignedRunId;
<ChatContextStrip
  workspaceId={workspaceId}
  branch={branch}
  worktreePath={worktreePath}
  plan={planBadge}
  progress={taskProgress}
  runState={runState}
  modelLabel={modelLabel}
  contextUsage={contextUsage}
/>
```

### Decision: Settings owns OpenSpec runtime install/health

**Decision**: Add a Settings tab named `OpenSpec` near Planning/Final Touches. Backend exposes detect/install/update commands. Plans call readiness checks before ready/running.

**Rationale**: OpenSpec is a first-class engine. Users should not install it manually or discover missing runtime only after a failed plan run.

**Rust command shape**:

```rust
// src-tauri/src/models/openspec_runtime.rs
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenSpecRuntimeStatus {
    pub state: String, // "missing" | "ready" | "installing" | "error"
    pub version: Option<String>,
    pub executable_path: Option<String>,
    pub schema: Option<String>,
    pub project_ready: bool,
    pub message: Option<String>,
}
```

```rust
// src-tauri/src/commands/settings.rs or commands/openspec.rs
#[tauri::command]
pub fn openspec_runtime_status(project_path: Option<String>) -> Result<OpenSpecRuntimeStatus, String> {
    OpenSpecRuntimeService::status(project_path.as_deref())
}
```

### Decision: CSS variables + discrete zoom attrs

**Decision**: Use `data-bb-zoom` on `document.documentElement` with discrete values (`80`, `90`, `100`, `110`, `125`, `150`) instead of React inline styles. CSS variables drive sizes/colors.

**Rationale**: Keeps source in `globals.css`, avoids component inline styles, and creates theme-ready tokens.

**Implementation snippet**:

```ts
// src/state/uiPreferences.ts
export const ZOOM_STEPS = [80, 90, 100, 110, 125, 150] as const;

export function applyZoom(percent: number) {
  document.documentElement.dataset.bbZoom = String(percent);
  localStorage.setItem("basebuild.zoom", String(percent));
}
```

```css
/* src/styles/globals.css */
:root {
  --bb-bg: #08090d;
  --bb-surface: #11131a;
  --bb-surface-silver: #c7c9d1;
  --bb-status-openspec: #8b5cf6;
  --bb-status-ready: #22c55e;
  --bb-status-running: #38bdf8;
  --bb-status-blocked: #f59e0b;
  --bb-ui-scale: 1;
}
html[data-bb-zoom="110"] { --bb-ui-scale: 1.1; }
html[data-bb-zoom="125"] { --bb-ui-scale: 1.25; }
.app-shell { font-size: calc(12px * var(--bb-ui-scale)); }
```

Keyboard handler:

```ts
useEffect(() => {
  function onKeyDown(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (!["+", "=", "-", "0"].includes(event.key)) return;
    event.preventDefault();
    updateZoomFromKey(event.key);
  }
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, []);
```

### Decision: Loosen DESIGN.md but keep hard invariants

**Decision**: `DESIGN.md` becomes a visual token contract, not a pure-black/single-orange prison. Keep 0px radius, one stylesheet, tooltips, local-first, and screenshot verification.

**Rationale**: The requested UI needs vibrant colors for tool kinds/statuses and syntax highlighting. Hard single-accent rules now block clarity.

### Decision: Remove direct reference comments

**Decision**: Replace source/docs comments that name external inspiration with neutral descriptions. Do not mention external IDEs in product code comments.

**Concrete replacements**:

```tsx
// Before in ChatHeader.tsx:
// Ported from the reference IDE's chat header structure...
// Reference: dream IDE (MIT)...

// After:
// Per-chat column header. Renders above the conversation, never scrolls out
// of view. Every interactive element has a title= tooltip.
```

```md
<!-- docs/agents/design-system.md -->
Replace named external-port language with:
"Panel-grid and chat-header patterns use Basebuild-owned split-tree and
context-header primitives. If external code is vendored in the future, add it as
an explicit module with license notice; do not leave ad-hoc source references in
component comments."
```

## Risks / Trade-offs

- **Risk:** Replacing grouped tool cards can make long runs verbose. → Mitigation: virtualize/height-cap the timeline region, auto-follow newest running row, and leave optional compact mode for later.
- **Risk:** OpenSpec installer varies by platform. → Mitigation: detect first; implement Windows path explicitly; show manual-install fallback; never auto-install.
- **Risk:** CSS zoom can clip dense panels. → Mitigation: test 960×640 at 100/125/150% plus zoom steps; clamp popovers; screenshot each state.
- **Risk:** Direct-copy licensing conflicts with no-reference preference. → Mitigation: clean-room implementation only unless a future module carries MIT notices.
- **Risk:** Existing `chat-first-shell` still owns composer mic/context tasks. → Mitigation: this change can absorb context meter/zoom/context strip; avoid redoing microphone unless task explicitly keeps it.

## Migration Plan

1. Add runtime/status models and settings commands for OpenSpec detection.
2. Add Settings → OpenSpec tab and readiness gates.
3. Refactor chat activity from grouped tool cards to flat `ActivityTimeline` rows.
4. Add `ChatContextStrip` and wire branch/worktree/plan/progress/model/context data.
5. Add Markdown/code rendering and theme tokens.
6. Add zoom state, keyboard shortcuts, and indicator.
7. Declutter sidebar and update modals/navigation targets.
8. Update `DESIGN.md`, docs, and `mvp.md`.
9. Verify frontend, Rust, e2e, UI invariants, and screenshots.

## Open Questions

- Which OpenSpec distribution source should Settings use first on Windows: bundled OMP plugin catalog, GitHub release, npm package, or user-supplied executable? Default for implementation: detect existing executable and provide manual path first; add network installer only behind explicit confirmation.
- Should optional compact timeline mode be included now or deferred? Default: defer. The owner asked for no grouping.
- Should OpenSpec archive/sync be one button or two separate actions? Default: separate; archive moves completed changes, sync merges specs while keeping active.
