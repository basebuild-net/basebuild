# Proposal: OpenSpec Chat Workbench

## Why

PR #26 hardened the MVP control-plane mechanics, but the next owner direction is narrower and more product-defining: Basebuild should be a reliable chat-first wrapper around OpenSpec, not a parallel planning system. The first lovable loop is: generate ideas in chat, convert selected ideas into complete OpenSpec artifacts, run the queue through worktrees when configured, then finish with review/merge/prune actions.

The current UI still has too much planning chrome, grouped activity that hides what agents are doing, strict monochrome design constraints that fight status-heavy chat, and no first-class way to install/manage OpenSpec itself from Settings.

## What Changes

- Make **OpenSpec the planning and implementation engine**: Basebuild prompts agents to ask for idea/category/project clarification, but artifact generation, implementation planning, apply, verify, archive/sync, and final touches route through OpenSpec changes.
- Add **OpenSpec installation and health management** in Settings: detect, install/update, select version/channel, show project readiness, and block OpenSpec-run launch when the toolchain is missing.
- Replace grouped/lumped activity with a **strict chronological agent timeline**: thinking, assistant text, tool calls, approvals, questions, captures, notices, errors, and completion render as separate timeline rows in the exact sequence received.
- Split thinking into visible blocks whenever a tool call or question interrupts it; never concatenate reasoning with normal assistant content.
- Render **all agent conversations** with runtime metadata: engine/runtime, provider/model/effort, transport capability, branch/worktree, workspace id, assigned plan, OpenSpec change, plan progress, queue state, and context-window utilization.
- Add clickable UI for agent questions and A/B choices across native, OMP RPC, and degraded prose flows.
- Make the **Planning Command Center visual-first**: stage cards, live counts, status words/colors, progress bars, running/queued/blocked totals, obvious `+` actions, and one-click paths from idea → OpenSpec → ready → queued/running → review/merge/archive.
- Move persistent left navigation to only **Projects, Chats, Settings, Updates**; remove persistent plan/flow/files clutter from the left side. Plans/Ideas stay reachable from chat affordances and project modals.
- Modernize visual design: flatter spacing, larger silver tabs, larger plus button, more `…` menus, dark mode by default, vibrant semantic colors for plan/tool/status types, syntax-highlighted markdown/code, and CSS variables for future themes.
- Add app zoom: `Ctrl/Cmd + +`, `Ctrl/Cmd + -`, `Ctrl/Cmd + 0`, plus a bottom-right zoom indicator.
- Remove product-code and agent-doc comments that directly name external reference IDE/codebases unless the dependency is intentionally shipped as a module with its license/notice. Use reference apps as design inspiration only; do not copy substantial code unless legal attribution is carried in a permitted module boundary.
- Update `DESIGN.md` to be less restrictive: keep 0px radius and local-first rules, but move from pure-black/single-orange to tokenized dark surfaces, neutral silver structure, and vibrant status colors.
- Update `mvp.md` so the accepted MVP is explicitly: `generate ideas → generate OpenSpec artifacts/full implementation plans → process queue → review/merge/final touches`, with worktrees used when configured.

## Capabilities

### New Capabilities

- `openspec-runtime-settings` — install, detect, update, and validate OpenSpec from Settings before plans can use it.
- `openspec-wrapper-flow` — chat-led idea generation followed by OpenSpec-owned artifacts, queue processing, and finish/archive/sync.
- `theme-zoom-shell` — tokenized visual system, zoom controls, status colors, and less restrictive design guidance.
- `chat-context-status-strip` — per-chat footer/header status showing branch, worktree, workspace id, plan, progress, queue, model, and context usage near the composer.

### Modified Capabilities

- `agent-chat` — all runtime conversations render rich metadata, markdown/code, thinking blocks, loading states, and visible run state.
- `tool-transcript-rendering` — activity is no longer grouped by default; every tool/thinking/question row is chronological.
- `chat-interactive-elements` — questions, multiple-choice, approvals, and degraded prose options are always clickable and resumable.
- `openspec-artifacts` — artifact generation uses OpenSpec as the source of truth and stores validated artifact bundles for assignment.
- `plan-chat-assignment` — assignment binds OpenSpec change + progress + worktree policy visibly under each chat input.
- `planning-flow-board` — command center becomes a visual cockpit with live counts, status words/colors, progress bars, add-more actions, OpenSpec generation actions, and running worker visibility.
- `chat-header-context` — header/context surfaces show workspace, branch, worktree, plan, progress, queue, and model without crowding.
- `chat-composer-controls` — composer gains context progress and zoom/status indicators while keeping model/effort visible.
- `desktop-shell` — persistent left navigation is reduced to Projects / Chats / Settings / Updates.
- `planning-prompt-settings` — prompts focus on asking good idea/scoping questions; implementation instructions delegate to OpenSpec.

## Impact

- **Frontend:** `ChatPanel.tsx`, `QuestionCard.tsx`, `ChatHeader.tsx`, `ChatComposerRail.tsx`, `PlanningInspector.tsx`, `ProjectSidebar.tsx`, `SettingsModal.tsx`, `StatusBar.tsx`, `src/styles/globals.css`, and test fixture/e2e coverage.
- **Backend:** OpenSpec tool detection/install commands in a settings/runtime service; plan-run queue readiness gates; activity event normalization additions where needed.
- **State:** settings keys for OpenSpec installation source/version, zoom level, theme token mode, and per-chat status strip preferences; no prompt/code upload.
- **Docs:** `DESIGN.md` loosened to tokenized flat dark UI; `docs/agents/design-system.md`, `docs/agents/agent-runtime.md`, `docs/agents/desktop-shell.md`, and `mvp.md` updated.
- **Security:** local-first preserved. Installing OpenSpec is explicit user action. External reference repos are not fetched or copied at runtime. Questions/options render escaped text. Worktree/branch/final-touch operations remain confirm-gated.
- **Ordering:** this should follow or absorb the unfinished pieces of `chat-first-shell` composer/context work and can supersede any future plan whose main goal is an independent non-OpenSpec planning engine.
