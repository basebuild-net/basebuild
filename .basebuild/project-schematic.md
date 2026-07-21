# Project Schematic: Basebuild

## Purpose

Basebuild is an open-source, local-first desktop control plane for AI coding
agents. It runs coding agents through its own in-house native agent loop
(provider streaming, tool calling, approval gates, and ask-user interactions
handled directly), and gives projects a shared visual workspace: integrated
terminals, source control, and a persistent plan pipeline that turns vague
goals into scoped, trackable work.

It is native-first. Every core feature works with no external CLI installed.
OhMyPi (OMP) is an optional, additive enhancement (terminal panel, plan runner,
optional chat profile, credential import, last-resort sign-in fallback), never a
dependency: no core path routes through OMP when a native implementation
exists. Basebuild does not replace Git or an editor; it gives them a shared
workspace and a durable plan pipeline.

## Target users

Primary users are developers and agent operators who run AI coding agents on
real projects and want a reliable, minimal desktop shell around them.

- **As a developer**, I want to open a project, chat with a coding agent, run a
  terminal, and see my plans in one window so I can stay in flow.
- **As an agent operator**, I want to generate ideas, refine them into plans,
  and dispatch a plan to a chat with a single reference id so the agent picks
  up exactly what to do.
- **As a project maintainer**, I want a project schematic and plan history
  persisted locally, not in a cloud service.

Users range from solo founders to small teams, mostly on macOS, Windows, or
Linux workstations.

## Tech stack

- **Frontend:** React 19 + TypeScript + Vite, running inside a Tauri v2 webview.
- **Desktop core:** Rust + Tauri v2.
- **Chat runtime:** in-house native agent loop (`agent_loop_service.rs`) — all
  providers (OpenAI, Anthropic, Devin, GLM, etc.) route through it; provider
  OAuth/PKCE flows are owned end to end and tokens live in the local database.
- **Terminal:** `portable-pty` (Rust) for PTY shells, `xterm.js` for rendering.
- **Local state:** `rusqlite` for sessions, tabs, plans, ideas, credentials, and
  recent projects.
- **Planning:** OpenSpec is the primary planner; plan artifacts and roadmap live
  locally under `openspec/` and `.basebuild/`.
- **Build tooling:** npm scripts, `cargo`, `tauri-cli`.

## Architecture notes

- Classic Tauri shell: Rust commands expose OS access and the native agent
  loop; React renders everything; state lives in SQLite and the project folder.
- Major UI regions: left activity sidebar (projects/sessions/panels), center
  workspace (splittable panel grid of chat, terminal, file, and schematic
  tabs), and planning surfaces (Ideas, Plans, Inspector).
- Workspace panels are generic and tabbed; each tab has a `kind`: `chat`,
  `terminal`, `file`, `omp`, or `schematic`. Tabs render through `PanelHeader`.
- Plans are first-class objects with a fixed lifecycle:
  `draft → openspec → ready → running → finished`; `cancelled` can end from any
  non-terminal status.
- Agents must read `AGENTS.md` and `DESIGN.md` before UI or convention changes.
- Only modify `AGENTS.md` or this project schematic with explicit user approval.

## Design constraints

- Source of truth is `DESIGN.md`: pure black canvas, pure white text, orange
  (`#ff5606`) accent, restrained radius via tokens (no hardcoded radius).
- No inline styles, no CSS modules, no styled components. All styles live in
  `src/styles/globals.css`.
- Utilities only appear when reused. Document new utility classes in
  `AGENTS.md` and `DESIGN.md`.
- Fonts: Space Grotesk (UI), JetBrains Mono (paths, code, terminal).
- Tooltips on every interactive element.
- Layout grid is CSS-variable driven: `--bb-sidebar-w`, `--bb-rail-w`, with
  collapsed states.

## Development conventions

- Run `npx tsc --noEmit`, `npm run build`, and `cargo check` after any
  non-trivial change; add/extend tests where practical.
- Keep Tauri command signatures and `src/lib/*.ts` wrappers in sync; lib files
  are thin invoke wrappers, one service per backend domain.
- Error messages surface to the UI, not the console.
- Prefer existing patterns over new abstractions; do not add a second
  convention beside an existing one.
- Commit in small, focused, verified milestones; feature branches only.

## Current priorities

1. Native-first minimal harness: simplify the shell, larger elastic workspace
   tabs, faster and more reliable startup, and keep the renderer lean.
2. Complete the AI workbench loop: generate ideas → OpenSpec artifacts →
   process queue → merge/archive, with worktrees when configured.
3. Make OMP fully optional everywhere: native usage/telemetry and plan-run
   paths, with OMP surfaces gated on a detected install.
4. Harden startup and project-switch reliability (readiness-gated hydration,
   no partial/blank/orphan states).
5. Keep the largest renderer components decomposed and maintainable.

## Open questions

- How aggressively should backgrounded panels unmount (keep-alive bound) before
  users notice re-mount cost?
- Should the OMP telemetry loop be retained as opt-in or removed once native
  telemetry fully covers it?
