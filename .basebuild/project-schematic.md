# Project Schematic: Basebuild

## Purpose

Basebuild is an open-source desktop control plane for AI coding agents. It wraps
the OhMyPi (OMP) CLI in a local-first, cross-platform interface so users can
manage projects, run integrated terminals, track source control, and turn vague
goals into scoped, trackable plans without leaving the app.

It does not replace OMP, Git, or an editor. It gives those tools a shared
visual workspace and a persistent plan pipeline.

## Target users

Primary users are developers and agent operators who work with OMP or similar
CLI-first AI coding agents on real projects.

- **As a developer**, I want to open a project, see its plans, and run a terminal
  in the same window so I can stay in flow.
- **As an agent operator**, I want to generate ideas, refine them into plans,
  and open a plan in a terminal with a single reference id so the agent picks
  up exactly what to do.
- **As a project maintainer**, I want a project schematic and plan history
  persisted locally, not in a cloud service.

Users range from solo founders to small teams, mostly on macOS, Windows, or
Linux workstations.

## Tech stack

- **Frontend:** React 18 + TypeScript + Vite, running inside a Tauri v2 webview.
- **Desktop core:** Rust + Tauri v2.
- **Terminal:** `portable-pty` (Rust) for PTY shells, `xterm.js` for DOM rendering.
- **Local state:** `rusqlite` for sessions, tabs, plans, ideas, and recent projects.
- **Project metadata:** OpenSpec-style files under `.basebuild/` and `.omp/`.
- **Build tooling:** npm/pnpm scripts, `cargo`, `tauri-cli`.

## Architecture notes

- The app is a classic Tauri shell: Rust commands expose OS access, React
  renders everything, state lives in SQLite and the project folder.
- Major UI regions: left sidebar (projects/sessions), center workspace (terminal,
  file viewer, or project schematic tab), right side panel with `Plans`,
  `Files`, and `Source` tabs.
- Workspace tabs are generic. Each tab has a `kind`: `terminal`, `file`, or
  `empty` (schematic view).
- Plans are first-class objects with a fixed lifecycle:
  `draft → openspec → ready → running → finished`. `cancelled` can
  end from any status.
- Agents must read `AGENTS.md` and `DESIGN.md` before UI or convention changes.
- Only modify `AGENTS.md` or this project schematic with explicit user approval.

## Design constraints

- Source of truth is `DESIGN.md` (`Basebuild Mono Desktop`): pure black canvas,
  pure white text, orange (`#ff5606`) accent, 0px border radius everywhere.
- No inline styles, no CSS modules, no styled components. All styles live in
  `src/styles/globals.css`.
- Utilities only appear when reused. Document new utility classes in
  `AGENTS.md` and `DESIGN.md`.
- Fonts: Space Grotesk (UI), JetBrains Mono (paths, code, terminal).
- Tooltips on every interactive element.
- Layout grid is CSS-variable driven: `--bb-sidebar-w: 220px`,
  `--bb-rail-w: 260px`, with collapsed states at `36px`.

## Development conventions

- Run `npm run build` and `cargo check` after any non-trivial change.
- Keep Tauri command signatures and `src/lib/*.ts` wrappers in sync.
- Add/update tests for new Rust commands and complex UI interactions where
  practical.
- Error messages should be surfaced to the UI, not swallowed in the console.
- Prefer existing patterns over new abstractions; do not create additional
  conventions beside those already in the codebase.
- Commit in small, focused units with descriptive messages.

## Current priorities

1. Complete the right side panel refactor: `Plans`, `Files`, and `Source` tabs
   are wired; continue hardening URL handling and tab persistence.
2. Finish generalizing workspace tabs so terminal, file viewer, and project
   schematic tabs coexist and restore cleanly across sessions.
3. Wire the **Generate Plans** / **Suggest More** flow to OMP so plans can be
   generated from a goal using the project schematic as context.
4. Persist OpenSpec proposal artifacts inside `.basebuild/` or `openspec/`
   and expose them in the UI.
5. Add integration smoke tests for the tab model and file-service commands.

## Open questions

- Should non-terminal tab kinds (`file`, `empty`) restore their previous state
  when the app restarts, or is session-only persistence enough?
- How should the app handle large files in the file viewer? Should there be a
  size cutoff or lazy reader?
- When generating plans from OMP, should results be appended as draft plans
  immediately or shown in a transient review list first?
