# Basebuild Desktop — Agent Guide

Basebuild is an open-source desktop control plane for AI coding agents.
Read this file before making any code or documentation change.

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
- **Collapsible columns** — left sidebar and right plan panel both collapse to
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

1. **Left sidebar** (220px → 36px collapsed) — projects and sessions.
2. **Center workspace** — top session header, workspace tabs (terminal sessions),
   then the active tool view.
3. **Right plan panel** (260px → 36px collapsed) — plans, tasks, idea
   generation, focus mode.

The center workspace uses a compact tab bar for switching tools:
**Terminal / Source / Debug**. The right panel is not a tab; it is the primary
work surface for plans.

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

- `id`, `referenceId` — internal id and a short stable reference like `PLAN-7`. 
- `title`, `description` — what and why.
- `goal` / `target` / `finalGoal` — user-facing intent that generated the plan.
- `priority` — 0–100; higher is more urgent.
- `status` — lifecycle state.
- `tags` — free-form strings for filtering.
- `sessionId` — ties the plan to a workspace session.
- `createdAt`, `updatedAt`, `completedAt` — audit timestamps.

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
    layout/          # Shell: AppShell, ProjectSidebar, ToolTabs, WorkspaceTabs, PlanPanel
    panels/          # Feature panels: TerminalPanel, SourcePanel, DebugPanel
  lib/               # Tauri invoke wrappers — one file per backend domain
  state/             # React state hooks
  styles/
    globals.css      # Single centralized CSS file

src-tauri/
  src/
    commands/        # Tauri command handlers — one file per domain
    services/        # Business logic — one file per domain
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

- One service per domain. Keep commands thin — validate input, call service,
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
- Lib files in `src/lib/` must not contain React state logic — they are thin
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
- `docs/SECRETS.md` is release / signing secrets — do not leak values.
- Update all of the above when a change invalidates their content.

There is no `LICENSE` file yet. If you add one, mention it in `README.md`.

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

## Documentation Maintenance Rule

When you change the following, update its documentation in the same change:

| Change | Document |
|---|---|
| Design tokens, layout, or CSS classes | `DESIGN.md` and `AGENTS.md` |
| Plan model or status semantics | `AGENTS.md` |
| Build / dev / secrets | `docs/DEVELOPMENT.md` or `docs/SECRETS.md` |
| High-level project pitch or contribution | `README.md` |
| OpenSpec plan | `openspec/changes/<change-name>/` |
