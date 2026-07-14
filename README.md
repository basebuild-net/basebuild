# Basebuild

A local-first desktop control plane for AI coding agents.

Basebuild pairs a first-party agent harness — native chat with a real tool
loop, per-tool approvals, and MCP support — with deep
[OhMyPi (OMP)](https://github.com/oh-my-pi) integration, a persistent planning
pipeline, integrated terminals, and source control in one cross-platform
window. Vague goals go in; scoped, trackable, executor-ready plans come out —
and everything stays on your machine.

## Features

- **Native agent chat** - first-party harness with streaming responses, a
  gated tool loop (read/edit/glob/grep/command execution behind a per-tool
  approval gateway with an audit trail), MCP client (stdio, HTTP, SSE),
  discoverable slash commands, and per-project model defaults.
- **Planning workspace** - one `Categories → Ideas → Plans` model: generate
  idea categories and grounded ideas as visible chat turns, pick the ones
  worth doing, and promote them into plans. Plans flow through
  `draft → openspec → ready → running → finished`, generate real OpenSpec
  artifacts, and can queue up with isolated git-worktree runs.
- **Portable planning skills** - the same planning system as plain skills
  (`skills/basebuild-planning`, `skills/basebuild-project-schematic`) that run
  in any skill-aware harness with no app installed, storing durable data in
  `.basebuild/` files. See [Skills](#skills).
- **Integrated terminal** - real PTY-backed terminals backed by
  [portable-pty](https://github.com/wez/wezterm/tree/main/portable-pty) and
  rendered with [xterm.js](https://xtermjs.org/); OMP sessions run as
  first-class tabs with usage telemetry.
- **Source control** - Git status, diff, stage, commit, and history using the
  installed Git CLI.
- **Agent-aware context** - project schematic, plan reference ids, and context
  files funnel into sessions so the agent knows exactly what to work on.
- **Local-first** - SQLite for dynamic state, OpenSpec and `.basebuild/` files
  for plans, in-app signed updates, no phone-home, analytics disabled by
  default.

## Preview
<img width="1270" height="792" alt="image" src="https://github.com/user-attachments/assets/7bbc3d54-2f60-41c0-b362-b4977586a5bd" />

## Skills

Basebuild ships its planning system as portable skills: plain
`skills/<name>/SKILL.md` folders that work in any skill-aware harness (OMP,
Claude Code, opencode, …) and inside the app itself. To use one outside this
repo, copy the skill folder into your harness's skills directory and invoke it
with a trigger phrase below. No Basebuild app required.

### `basebuild-planning` — ideas to executor-proof plans

Stores everything as files under `.basebuild/` (`categories.md`, `ideas/`,
`plans/`) so planning data is git-visible and durable. Plans are written by a
strong planning model to be **executor-proof**: embedded constraints, exact
paths, per-task acceptance criteria, and verification commands, so a weaker
executing model can't drift.

| Say | What happens |
|---|---|
| "planning status" | Read-only board: ideas and plans by status, task progress |
| "categories" | Load or generate 3-8 project-specific idea categories; edit and persist |
| "generate ideas" / "brainstorm" | Numbered, grounded ideas per chosen category; pick by number, loop until you stop |
| "promote idea X" / "plan this" | Turn picked ideas (individually or bundled) into a plan folder with plan.md + tasks.md |
| "work the plan" | Approve (`ready`), execute `tasks.md` top to bottom (`running`), finish with evidence |
| "archive plan X" | Move finished/cancelled plans to `plans/archive/`; archive ideas in place |

Plan lifecycle: `draft → planned → ready → running → finished` (+ `cancelled`).
Engine-pluggable: writes native plan artifacts by default, or hands promotion
to a detected planning skill (e.g. OpenSpec `propose`) and tracks its
artifacts by reference. The choice is asked once and persisted in
`.basebuild/config.toml`.

### `basebuild-project-schematic` — project fundamentals

Creates and maintains `.basebuild/project-schematic.md`: what the project is,
what it should become (Vision), its core rules, and current priorities — the
steering document `basebuild-planning` draws categories and ideas from.

| Say | Mode |
|---|---|
| "create a schematic" | Guided section-by-section questionnaire, prefilled from repository facts |
| "update the schematic" | Per-section review; untouched sections preserved verbatim |
| "re-align" / "is the schematic still accurate" | Evidence-based drift report vs repo reality and planning data; edits applied only on approval |

### App-driven skills

- **`basebuild-session-title`** - generates concise session titles from
  terminal/tab activity.
- **`basebuild-autonomous`** - autonomous continuation controller (next-steps,
  next-idea, publishing modes) driven by the app UI.

## Stack

- **Frontend**: React + TypeScript + Vite (Tauri webview)
- **Desktop core**: Rust + Tauri v2
- **Terminal**: portable-pty + xterm.js
- **State**: rusqlite

## Quick start (desktop app)

This repo is the source for the **desktop application**. Running the Vite dev server alone (`npm run dev`) only renders a non-functional web preview because terminals, source control, and the SQLite state layer require the Rust Tauri backend.

```bash
npm install
npm run tauri dev
```

You need:

- Node.js 20+
- Rust (stable)
- Visual Studio C++ Build Tools (Windows) or equivalent C++ toolchain

## Packaging

```bash
npm run tauri build
```

The installer (NSIS) is written to `src-tauri/target/release/bundle/nsis/`.

## Releasing

Patch versions bump automatically from the current version (starting at `0.0.1`):

```bash
node scripts/bump-version.mjs
```

This updates `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
Commit the result, tag it, and push:

```bash
git add .
git commit -m "chore(release): bump version"
git tag v0.0.2
git push origin main v0.0.2
```

Only the patch component is bumped by default. To move to `0.1.0` or `1.0.0`, edit the version string manually before committing.

## Documentation

- [`AGENTS.md`](./AGENTS.md) - agent guide: mandatory invariants and a router to the [`docs/agents/`](./docs/agents/) guides.
- [`DESIGN.md`](./DESIGN.md) - Basebuild Mono Desktop visual design system.
- [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) - development notes, architecture, and build scripts.
- [`docs/SECRETS.md`](./docs/SECRETS.md) - release signing and infrastructure secrets.
- [`openspec/`](./openspec/) - OpenSpec planning artifacts.
- [`skills/`](./skills/) - portable agent skills (planning, schematic, session tools).

## Contributing

Contributions are welcome. Please read [`AGENTS.md`](./AGENTS.md) before making
changes - it holds the mandatory invariants and routes to the detailed
[`docs/agents/`](./docs/agents/) guides (workflow, testing, design system,
runtime, desktop shell, and OpenSpec).

## License

Attribution-required license - feel free to use, improve, and distribute, but
you must credit basebuild.net. Taking code or assets without attribution is
prohibited. See [`LICENSE`](./LICENSE) for full terms.
