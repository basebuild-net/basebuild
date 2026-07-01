# Basebuild Desktop - Agent Guide

Basebuild is an open-source desktop control plane for AI coding agents.
Read this file before making any code or documentation change.

## Branching Discipline (Non-Negotiable)

**Never commit directly to `main` when a feature branch exists.** If you are
on a branch, stay on it. All work - including CI fixes, bug fixes, and chores -
goes on the current feature branch and is merged to `main` via PR or fast-forward
merge when the work is complete.

Rules:
1. **Check `git branch` before committing.** Know where you are.
2. **If a feature branch exists for your work, commit to it.** Do not switch to
   `main` to "just fix one thing" - fix it on the branch.
3. **`main` only receives commits via merge from a feature branch** or direct
   commits for trivial docs/changelog when no branch is active.
4. **Before starting work, create or checkout the correct branch.** If unsure,
   ask.
5. **Rebase your branch onto `main` before merging** to avoid conflicts.
6. **Never force-push to `main`.**

## Project Purpose

Basebuild wraps the [OhMyPi (OMP)](https://github.com/oh-my-pi) CLI in a
local-first desktop interface. The main user goal is to turn a vague intent
into scoped, tracked work through a persistent **plan pipeline**, then execute
that work in integrated terminals with full agent context.

## Role of This Guide

This document captures the implicit standards that are not enforced by linters:

- Visual design system and where its source of truth lives.
- Layout and component conventions.
- State, data model, and naming patterns.
- Plan pipeline semantics.
- How to keep documentation accurate when the code changes.

## Design System

`DESIGN.md` is the canonical visual design reference. Read it before any UI
change. Summarised here so agents do not need to cross-reference constantly:

- **Pure black canvas** (`#000000`), pure white text (`#ffffff`), single orange
  accent (`#ff5606`).
- **0px border radius everywhere.** No exceptions.
- **No decorative borders.** Layer on whitespace, hover lifts, and uppercase
  typography.
- **Fonts:** Space Grotesk (UI), JetBrains Mono (numbers, paths, code, terminal).
- **Compact and dense.** Minimal padding, no wasted space.
- **Tooltips on every interactive element** (`title` attribute).
- **Collapsible columns** - left sidebar and right plan panel both collapse to
  icon-only (36px).

CSS custom properties in `src/styles/globals.css` map 1:1 to `DESIGN.md` tokens.
Keep them in sync.

### Reusable CSS Classes

`src/styles/globals.css` is the only stylesheet. No CSS modules, no styled
components, no inline styles. Add new utility classes rarely, and document them
here and in `DESIGN.md`.

Current classes include `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-icon`,
`.btn-icon-sm`, `.card`, `.badge`, `.pill`, `.input`, `.pre`, `.stack`,
`.stack-sm`, `.row`, `.row-between`, `.text-muted`, `.text-sm`, `.text-ok`,
`.text-danger`, `.mono`.

## App Shell Layout

The live shell is a three-column grid:

1. **Left sidebar** (220px → 36px collapsed) - projects and sessions.
2. **Center workspace** - session header, workspace tabs, and the active tab
   view (terminal, file viewer, or project schematic).
3. **Right side panel** (260px → 36px collapsed) - stacked accordion sections
   for **Plans**, **Files**, and **Source**. Each section can be folded or
   expanded, and sections can be dragged to reorder. The order is persisted
   in local storage.

The center workspace uses a compact tab bar for switching tools:
**Terminal / Debug**. Source control lives in the right panel `Source`
section. Workspace tabs are generic and each tab has a `kind`: `terminal`,
`file`, or `empty`.

- Use the **+** menu on the workspace tab bar to add a **Terminal** or
  **Schematic** tab.
- Click a file in the right panel’s **Files** section to open it as a `file`
  tab.
- An `empty` tab renders the project schematic from
  `.basebuild/project-schematic.md`.

Shell state is driven by `data-sidebar="collapsed|expanded"` and
`data-rail="collapsed|expanded"` attributes on `.app-shell`. CSS handles the grid
width changes and hides panel labels in collapsed mode.

## Plan Pipeline Conventions

Plans are first-class objects. A plan moves through a fixed status lifecycle:

```
draft → openspec → waiting → in_progress → finished
```

`cancelled` may terminate from any status.

### Status semantics

| Status | Meaning |
|---|---|
| `draft` | Captured quickly, not yet refined into an OpenSpec proposal. |
| `openspec` | Ready to (or already did) generate an OpenSpec change proposal. |
| `waiting` | Blocked by user review, external approval, or another plan. |
| `in_progress` | Actively being worked on, usually mapped to a live terminal. |
| `finished` | Completed and retained for reporting. |
| `cancelled` | Discarded. |

### Plan fields

A plan should be enough that an agent can pick it up with zero extra context:

- `id`, `referenceId` - internal id and a short stable reference like `PLAN-7`. 
- `title`, `description` - what and why.
- `goal` / `target` / `finalGoal` - user-facing intent that generated the plan.
- `priority` - 0–100; higher is more urgent.
- `status` - lifecycle state.
- `tags` - free-form strings for filtering.
- `sessionId` - ties the plan to a workspace session.
- `createdAt`, `updatedAt`, `completedAt` - audit timestamps.

### Plan UI behaviours

- Plans are shown in **lanes grouped by status** in the right panel.
- Each plan exposes: edit, focus mode, copy reference (`#PLAN-N`), open in
  terminal, and set status.
- AI flows live inside the panel: **Generate Plans** from a goal input, **Suggest
  More Plans** from full context, and **Enhance** a single plan.

When you touch anything plan-related, make sure both `src/lib/plans.ts` and
`src-tauri/src/services/plan_service.rs` agree on the shape.

## Project Structure

```
src/
  components/
    layout/          # Shell: AppShell, ProjectSidebar, SidePanel, ToolTabs, WorkspaceTabs, PlanPanel
    panels/          # Feature panels: TerminalPanel, SourcePanel, FilesPanel, FileViewer, ProjectSchematicTab, DebugPanel
  lib/               # Tauri invoke wrappers - one file per backend domain
  state/             # React state hooks
  styles/
    globals.css      # Single centralized CSS file

src-tauri/
  src/
    commands/        # Tauri command handlers - one file per domain
    services/        # Business logic - one file per domain
    models/          # Serializable data types
    app_state.rs     # Tauri managed state (terminal manager)
    lib.rs           # Tauri builder + command registration
```

### Adding a New Integration

1. Rust service: `src-tauri/src/services/<name>_service.rs`
2. Rust model: `src-tauri/src/models/<name>.rs`
3. Rust command: `src-tauri/src/commands/<name>.rs`
4. Register in the appropriate `mod.rs` and `src-tauri/src/lib.rs`.
5. Frontend lib: `src/lib/<name>.ts`
6. Frontend panel or layout component under `src/components/`.
7. If the feature belongs on the right plan panel, add it to `PlanPanel.tsx`.
   Do not create extra side columns without a layout discussion.
8. Update this guide and `DESIGN.md` if the change affects documented behaviour.

## Code Standards

### Rust

- One service per domain. Keep commands thin - validate input, call service,
  map errors.
- Use `thiserror` for typed errors. Expose a simple error string to the frontend
  unless a structured response is needed.
- Serializable models live in `src-tauri/src/models/`. Derive `Serialize`,
  `Deserialize`, `Debug`, and `Clone` by default.
- Keep blocking I/O in `spawn_blocking` where possible; return futures to Tauri.

### TypeScript / React

- `type` over `interface` for sidecar object shapes.
- Props are plain types, e.g. `type FooProps = { ... }`.
- Use hooks from `src/state/` for all cross-component state.
- Lib files in `src/lib/` must not contain React state logic - they are thin
  Tauri invoke wrappers only.
- Prefer `useCallback`/`useMemo` only when needed for correctness or stable
  dependency lists.
- Tooltips must be on every interactive element. Verify with `title=`, not just
  `aria-label`.

### Naming

- Files and directories are `kebab-case` except React components which are
  `PascalCase.tsx`.
- Rust modules are `snake_case`.
- Tauri commands are `camelCase`.
- Plan statuses are `snake_case`.

## Open Source Housekeeping

This project is open source. Keep it approachable:

- `README.md` is the first impression. Keep it simple: what, why, stack, quick
  start, contributing pointer.
- `AGENTS.md` (this file) is for maintainers and contributors.
- `DESIGN.md` is the visual contract.
- `docs/DEVELOPMENT.md` is deep build and architecture notes.
- `docs/SECRETS.md` is release / signing secrets - do not leak values.
- Update all of the above when a change invalidates their content.

`LICENSE` is an attribution-required license - credit basebuild.net. It is already mentioned in `README.md`.

## Development

```bash
npm install
npm run tauri dev    # Dev app
npm run build        # Static frontend build
npm run tauri build  # Production installer
npx tsc --noEmit     # Type check
```

### Prerequisites

- Node.js 20+
- Rust (stable)
- Visual Studio C++ Build Tools (Windows) or equivalent C++ toolchain

## Visual Inspection Workflow

After every UI change, visually verify. Never yield a UI change without a
screenshot.

1. Run `npm run tauri dev` and open the app.
2. Use the browser/screenshot tool to capture the window.
3. Check alignment, spacing, hover states, collapsed/expanded modes, tooltips,
   and the active tool tab highlight.
4. Test the actual interaction.

## What Basebuild Is and Is Not

Basebuild is a **local-first modular wrapper** around terminal-based coding
tools. It is not a new agent, not a new IDE, and not a replacement for the CLI
workflows users already know.

### We are a wrapper

- We surface OMP, Git, terminals, and file exploration through a unified desktop
  shell.
- We provide tool setups, integration, and a visual plan pipeline, then hand
  execution back to CLI/IDE surfaces.
- We do not silently take over agents, change their environment, or modify a
  project without making the action visible and reversible.

### Respect the underlying tools

- Never assume Basebuild owns a project. `git`, `omp`, and editors are the source
  of truth; Basebuild persists only project-local metadata in `.basebuild/`.
- Do not spawn side effects (commits, PRs, installs, file edits) unless the user
  explicitly triggers them through the UI or an approved skill.
- When in doubt, ask. The default stance is conservative.

## Project Schematic

Every project managed by Basebuild should have a **Project Schematic** at
`.basebuild/project-schematic.md`. It is the single source of truth for what the
project is trying to become, how to work on it, and what agents should know.

### When is a schematic required?

- **Plan generation** requires a schematic. If none exists, the Generate Plans
  flow opens the Project Description modal to create one first.
- **Suggest More** is hidden until a schematic exists.
- **Create blank plan** opens the schematic file in the workspace so the user can
  edit it.

### Schematic sections

```markdown
# Project Schematic: <Name>

## Purpose
One-paragraph product goal.

## Target users
Who uses this and what are they trying to do.

## Tech stack
Runtime, framework, key libraries, and build tools.

## Architecture notes
Domain boundaries, important invariants, data model shape.

## Design constraints
Visual system, CSS rules, component reuse rules, file conventions.

## Development conventions
How code should be written: naming, error handling, tests, docs.

## Current priorities
Top 3–5 open concerns in priority order.

## Open questions
What is still unclear and needs a human decision.
```

The skill `basebuild-project-schematic` guides a human or agent through filling
this in. It asks careful questions and never fabricates answers.

### Updating the schematic

- Agents may **read** the schematic at any time.
- Agents may **propose** updates to the user; they must not overwrite it
  silently except for trivial factual fixes (typos, outdated links).
- The schematic should be updated when project purpose, stack, architecture, or
  conventions change.

## Design Stability Rules

Basebuild favours a small, consistent, maintainable codebase over fast patches.

### CSS health

- `src/styles/globals.css` is the only stylesheet. Keep it under 400 lines.
- Before adding a new class, find an existing one. If you must add one, document
  it in `AGENTS.md` and `DESIGN.md`.
- Never inline styles, even for one-off spacing exceptions. Add a reusable
  modifier or class instead.
- Prefer layout primitives (`.stack`, `.row`, `.card`) over bespoke component
  CSS.

### Component reuse

- A pattern that appears twice should be a component or utility.
- A pattern that appears three times must be a component or utility.
- Modals share one overlay/class contract; use the existing modal shape.
- Keep business logic in `src/lib/` and `src-tauri/src/services/`, not inline
  in components.

### Code maintainability

- One file per concern. Service files should read like a table of contents.
- Avoid premature abstraction, but also avoid duplicating almost-identical UI.
- Every new feature must leave the file tree cleaner than it found it, or the
  change is not complete.

## Data, Skills, and Community

### Local-first data

- Project schematics, plans, sessions, and settings live locally in SQLite and
  `.basebuild/` markdown files.
- Basebuild never phones home by default.

### Optional community aggregation

In the future, Basebuild may offer an **opt-in** `basebuild.net` integration:
- Aggregate anonymous usage patterns to improve default skills.
- Share community-tested skill configurations and project schematics.
- Always explicit, always revocable, never the default.

Until that feature is fully specified and documented in `docs/SECRETS.md`, do
not add network calls that upload data.

### Skill creation

- A Basebuild skill is a markdown instruction set in `skills/<name>/SKILL.md`.
- Skills must be narrow, useful, and explicit about what they can and cannot do.
- New skills are added through normal code review; they are not auto-generated
  and applied without testing.

### Testing skills

When you add or change a skill, run it against this repository at least once:
1. Read the skill.
2. Apply it to the Basebuild codebase as the test subject.
3. Verify the output is coherent and follows `AGENTS.md`.
4. Commit the skill and any resulting project-schematic updates together.

## Documentation Maintenance Rule

When you change the following, update its documentation in the same change:

| Change | Document |
|---|---|
| Design tokens, layout, or CSS classes | `DESIGN.md` and `AGENTS.md` |
| Plan model, Project Schematic, or status semantics | `AGENTS.md` and `.basebuild/project-schematic.md` |
| Build / dev / secrets | `docs/DEVELOPMENT.md` or `docs/SECRETS.md` |
| High-level project pitch or contribution | `README.md` |
| OpenSpec plan | `openspec/changes/<change-name>/` |
| Skills | `skills/<name>/SKILL.md` and `AGENTS.md` |
| Data collection / privacy behaviour | `AGENTS.md` and `docs/SECRETS.md` |
