# Basebuild Desktop — Agent Guide

Basebuild is an open-source desktop control plane for AI coding agents.
Read this file before making any code or documentation change.

## Quick Reference

- **Purpose**: Local-first desktop wrapper around OMP and terminal-based coding tools.
- **Stack**: Tauri (Rust), React + TypeScript, SQLite local state.
- **Design contract**: `DESIGN.md` is canonical. `src/styles/globals.css` is the only stylesheet.
- **Privacy**: Local-first. No phone-home. Analytics disabled by default.
- **No silent side effects**: No commits, PRs, installs, or file edits unless the user explicitly triggers them.

## Detailed Documentation

Detailed workflow docs live in `docs/agents/`. Read the relevant one before
starting work in that area:

| Document | Read when... |
|---|---|
| [`docs/agents/openspec.md`](./docs/agents/openspec.md) | Starting, applying, or archiving an OpenSpec change |
| [`docs/agents/testing.md`](./docs/agents/testing.md) | Verifying a change before yielding |
| [`docs/agents/design-system.md`](./docs/agents/design-system.md) | Changing UI, CSS, layout, or visual conventions |
| [`docs/agents/agent-runtime.md`](./docs/agents/agent-runtime.md) | Changing chat, terminal, OMP, adapters, permissions, analytics, or defaults |
| [`docs/agents/desktop-shell.md`](./docs/agents/desktop-shell.md) | Changing tabs, panels, workspace routing, or session state |

Also see:
- `DESIGN.md` — visual design contract
- `docs/DEVELOPMENT.md` — build and architecture notes
- `docs/SECRETS.md` — release/secrets (do not leak values)

## Project Structure

```
src/
  components/
    layout/          # Shell: AppShell, ProjectSidebar, SidePanel, ToolTabs, WorkspaceTabs, PlanPanel
    panels/          # Feature panels: TerminalPanel, ChatPanel, SourcePanel, FilesPanel, FileViewer, DebugPanel
  lib/               # Tauri invoke wrappers — one file per backend domain
  state/             # React state hooks
  styles/
    globals.css      # Single centralized CSS file

src-tauri/
  src/
    commands/        # Tauri command handlers — one file per domain
    services/        # Business logic — one file per domain
    models/          # Serializable data types
    app_state.rs     # Tauri managed state
    lib.rs           # Tauri builder + command registration
```

## Mandatory Invariants

1. **One stylesheet only.** `src/styles/globals.css`. No CSS modules, no inline styles.
2. **0px border radius.** No exceptions.
3. **Tooltips on every interactive element.** Verify with `title=`.
4. **Local-first.** No network calls that upload data unless explicitly specified.
5. **No silent side effects.** Ask before destructive actions.
6. **`type` over `interface`** for sidecar object shapes.
7. **Lib files are thin Tauri invoke wrappers only** — no React state logic.
8. **One service per domain.** Commands validate input, call service, map errors.
9. **Plan statuses are `snake_case`.** Lifecycle: `draft → openspec → waiting → in_progress → finished`.
10. **Commit milestones.** Keep large changes in coherent, verified milestones. If the user has explicitly asked for commits, commit each completed milestone separately with a clear message. Otherwise, report suggested commit points but do not create commits silently.

## Development

```bash
npm install
npm run tauri dev    # Dev app
npm run build        # Static frontend build
npm run tauri build  # Production installer
npx tsc --noEmit     # Type check
```

### Prerequisites

- Node.js 20+, Rust (stable), Visual Studio C++ Build Tools (Windows).

## Documentation Maintenance

When you change behavior, update its documentation in the same change:

| Change | Document |
|---|---|
| Design tokens, layout, or CSS classes | `DESIGN.md` and `docs/agents/design-system.md` |
| Plan model, Project Schematic, or status semantics | This file and `.basebuild/project-schematic.md` |
| Build / dev / secrets | `docs/DEVELOPMENT.md` or `docs/SECRETS.md` |
| High-level project pitch or contribution | `README.md` |
| OpenSpec plan | `openspec/changes/<change-name>/` |
| Skills | `skills/<name>/SKILL.md` and this file |
| Data collection / privacy behaviour | `docs/agents/agent-runtime.md` and `docs/SECRETS.md` |
| Agent/chat/terminal/adapter behavior | `docs/agents/agent-runtime.md` |
| Tab/panel/workspace routing | `docs/agents/desktop-shell.md` |
| Testing requirements | `docs/agents/testing.md` |
