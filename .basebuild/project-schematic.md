# Project Schematic: Basebuild Desktop

## Purpose

Basebuild is a local-first desktop control plane for AI coding agents. It wraps
[OhMyPi (OMP)](https://github.com/oh-my-pi) and other terminal-based tools in a
cross-platform Tauri v2 application, giving developers a visual project
workspace, an integrated terminal, source control, and a persistent plan
pipeline. The goal is to turn a vague intent into scoped, tracked work and then
execute that work in the agent's native terminal environment with full context.

## Target users

Primary users are developers who already use OMP or similar CLI agents and want
a structured way to manage what the agent should work on next, without leaving
their tools behind.

- **Solo developers** tracking multiple feature ideas across one or more projects.
- **Agent-first workers** who prefer to state a goal, review generated plans, and
  hand them to an agent rather than typing prompts repeatedly.
- **Small teams** that need lightweight project scoping and source-control
  visibility in one desktop window.

User stories:
- "I open my project, set a high-level goal, and get a prioritized list of
  MVP plans."
- "I move a plan to in-progress and click once to send its reference and
  context to a terminal running OMP."
- "I review git status, diff, commit, and history without leaving the app."

## Tech stack

- **Frontend**: React 18+, TypeScript, Vite, Tauri v2 webview
- **Desktop core**: Rust, Tauri v2
- **Terminal**: `portable-pty` (Rust), `xterm.js` (web)
- **Local state**: rusqlite / SQLite
- **Agent integration**: OhMyPi (OMP) CLI, invoked via Tauri commands and
  terminal streams
- **Build/package**: npm + cargo

## Architecture notes

The app is split into a Rust backend and a React frontend that communicate over
Tauri invoke/events.

- `src/components/layout/*` — shell components: sidebar, workspace tabs, tool
  tabs, right-side panels, modals.
- `src/components/panels/*` — feature panels: terminal, OMP debug, source.
- `src/lib/*` — thin Tauri invoke wrappers, one file per backend domain.
- `src/state/*` — React hooks for project, session, plan, OMP, and terminal
  state.
- `src/styles/globals.css` — single stylesheet and design token contract.
- `src-tauri/src/services/*` — business logic and SQLite access.
- `src-tauri/src/commands/*` — Tauri command surface exposed to the frontend.
- `skills/*` — markdown skill files consumed by OMP when Basebuild drives
  agent sessions.

Key invariants:
- Plans belong to a session and flow through a fixed status lifecycle:
  `draft → openspec → waiting → in_progress → finished` with `cancelled` as a
  terminal state.
- CSS lives in exactly one file. No inline styles, no per-component CSS.
- Basebuild does not replace OMP, Git, or editors. It wraps them.

## Design constraints

- Visual design is governed by `DESIGN.md`.
- Pure black canvas (`#000000`), pure white text (`#ffffff`), single orange
  accent (`#ff5606`).
- **0px border radius everywhere.** No exceptions.
- No decorative borders; layer with whitespace, hover lifts, and uppercase
  micro-typography.
- Fonts: Space Grotesk for UI, JetBrains Mono for code/paths/numbers.
- Extremely compact, dense, instrument-like UI. Tooltips on every interactive
  element.
- Components and utility classes must be reused. A pattern that appears twice
  should be a component; three times must be a component.

## Development conventions

- **Rust**: one service per domain; commands are thin; use typed errors.
- **TypeScript**: `type` over `interface` for props; keep React hooks in
  `src/state/`; lib files contain no React state logic.
- **Naming**: `kebab-case` files, `PascalCase.tsx` components, `snake_case`
  Rust modules, `camelCase` Tauri commands.
- **Tests**: add or update a test when a command or service boundary changes.
  Frontend UI changes require a screenshot/manual visual verification.
- **Documentation**: update `AGENTS.md`, `DESIGN.md`, `docs/DEVELOPMENT.md`, or
  `README.md` when a change invalidates them.
- **Commits**: milestone-style commits with a short subject and body that
  explains why.
- **Skills**: new skills live in `skills/<name>/SKILL.md` and are tested on
  this repository before shipping.

## Current priorities

1. Project Schematic support: read/write `.basebuild/project-schematic.md`, use
   it as the source of truth for AI plan generation, and expose it in the UI.
2. Right-side panel tabs: Plans, Files, Source Control as persistent utility
   tabs in the right column.
3. Workspace tab generalization: support terminal, file viewer, and empty tab
   kinds with a clear + menu.
4. GUI-driven OMP integration: run OMP in the background, surface interactive
   questions in the UI, and allow switching to terminal view.
5. Agent-aware AGENTS.md / schematic updates: agents should read both files
   before acting and propose edits rather than silently overwrite them.

## Open questions

- Should the Project Schematic be required before *any* plan creation, or only
  before AI-generated plans?
- What level of integration with OMP question/answer flow is feasible before
  the first release?
- How should Basebuild handle multi-root workspaces or projects without a
  `.git` directory?
- What opt-in `basebuild.net` aggregation features (skill sharing, usage
  patterns, community configs) are in scope for MVP?
- Should the Files tab use the OS file system or Git tree semantics, or both?
