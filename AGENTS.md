# Basebuild Desktop — Agent Guide

Basebuild is an open-source desktop control plane for AI coding agents.
Read this file before making any code or documentation change. Every rule
below is enforced in review: a PR that violates a Mandatory Invariant is
rejected regardless of feature quality. When another document conflicts with
this file, this file wins.

## Quick Reference

- **Purpose**: Local-first desktop wrapper around OMP and terminal-based coding tools.
- **Stack**: Tauri (Rust), React + TypeScript, SQLite local state.
- **Design contract**: `DESIGN.md` is canonical but **visual/non-technical only** — visual language, layout intent, colors, spacing, states. NEVER put CSS class names, selectors, flex/grid mechanics, event names, or any implementation detail in `DESIGN.md`; those go in `docs/agents/design-system.md`. `src/styles/globals.css` is the only stylesheet.
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
- `DESIGN.md` — visual design contract (visual/non-technical only)
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
   App update install buttons are the only approved blue CTA (`#2563eb`).
4. **Local-first.** No network calls that upload data unless explicitly specified.
5. **No silent side effects.** Ask before destructive actions.
6. **`type` over `interface`** for sidecar object shapes.
7. **Lib files are thin Tauri invoke wrappers only** — no React state logic.
8. **One service per domain.** Commands validate input, call service, map errors.
9. **Plan statuses are `snake_case`.** Lifecycle: `draft → openspec → ready → running → finished`. `cancelled` is reachable from any non-terminal status. Ideas use `concept → picked → archived`.
10. **Commit milestones.** Keep large changes in coherent, verified milestones. If the user has explicitly asked for commits, commit each completed milestone separately with a clear message. Otherwise, report suggested commit points but do not create commits silently.
11. **Feature branches.** Never build on `main`. Before starting any non-trivial change, create a branch named after the work (e.g. `feat/startup-update-splash`). If the current branch is already non-`main`, stay on it. Do not push commits to `main`. Only merge a feature branch into `main` after the work is verified.
12. **Roadmap tracks OpenSpec — always.** Any edit under `openspec/changes/**`
    (task checkbox, new proposal, re-scope, archive) MUST be accompanied, in the
    same commit/PR, by `node scripts/openspec-status.mjs --write` **and** a pass
    over the narrative sections of `openspec/ROADMAP.md` (Now / Merged — awaiting
    archive / Next / Proposed). The script only refreshes the status table; the
    narrative is your job. A PR that completes or merges a change MUST move its
    roadmap entry and cite the PR number.

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
| Visual design language (colors, spacing, states, layout intent) | `DESIGN.md` (visual/non-technical only) |
| CSS classes, selectors, or layout mechanics | `docs/agents/design-system.md` (NOT `DESIGN.md`) |
| Plan model, Project Schematic, or status semantics | This file and `.basebuild/project-schematic.md` |
| Build / dev / secrets | `docs/DEVELOPMENT.md` or `docs/SECRETS.md` |
| High-level project pitch or contribution | `README.md` |
| OpenSpec plan | `openspec/changes/<change-name>/` |
| OpenSpec progress (checkbox, propose, re-scope, archive) | `openspec/ROADMAP.md` — refresh table with `node scripts/openspec-status.mjs --write` and update narrative in the same commit (Invariant 12) |
| Skills | `skills/<name>/SKILL.md` and this file |
| Data collection / privacy behaviour | `docs/agents/agent-runtime.md` and `docs/SECRETS.md` |
| Agent/chat/terminal/adapter behavior | `docs/agents/agent-runtime.md` |
| Tab/panel/workspace routing | `docs/agents/desktop-shell.md` |
| Testing requirements | `docs/agents/testing.md` |

## Before You Yield — Checklist

Do not claim a change complete until every line holds:

- [ ] `npx tsc --noEmit` passes; `cargo check`/`cargo test` pass when Rust changed — actually run, never assumed.
- [ ] New interactive elements have `title=` tooltips; 0px radius; styles only in `globals.css`.
- [ ] Behavior docs updated per the Documentation Maintenance table above.
- [ ] If anything under `openspec/changes/**` changed: status table refreshed and `ROADMAP.md` narrative matches reality (Invariant 12).
- [ ] Work is on a feature branch; commit points reported, no silent commits.
