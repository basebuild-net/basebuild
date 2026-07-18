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
<img width="1617" height="956" alt="image" src="https://github.com/user-attachments/assets/63182654-0e5f-4883-b8c9-e2dd8ace7374" />

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

## Install the latest release

Official releases are published for Windows x64, Linux x64, and macOS
(universal Apple Silicon + Intel). The asset names are stable, so these
commands always resolve the latest published release; release automation does
not rewrite this README for every version.

### Windows

PowerShell:

```powershell
irm https://raw.githubusercontent.com/basebuild-net/basebuild/main/install.ps1 | iex
```

From `cmd.exe`:

```bat
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/basebuild-net/basebuild/main/install.ps1 | iex"
```

The script downloads the x64 NSIS installer from GitHub Releases and opens it.
To run silently, download [`install.ps1`](./install.ps1) and execute
`.\install.ps1 -Silent`; use `.\install.ps1 -DownloadOnly` to validate and
retain the installer without launching it.

### macOS

```bash
curl -fsSL https://raw.githubusercontent.com/basebuild-net/basebuild/main/install.sh | sh
```

This installs the universal app to `~/Applications`. Set
`BASEBUILD_INSTALL_DIR=/Applications` before running the script for a
system-wide destination when your account can write there. No Apple developer
account or Apple secrets are required. Releases are ad-hoc signed unless
notarization credentials are configured, so macOS may require **Open** or
**Control-click → Open** on first launch.

### Linux

Portable AppImage in `~/.local/bin/basebuild`:

```bash
curl -fsSL https://raw.githubusercontent.com/basebuild-net/basebuild/main/install.sh | sh
```

Debian/Ubuntu package with desktop-menu integration:

```bash
curl -fL https://github.com/basebuild-net/basebuild/releases/latest/download/Basebuild-linux-x86_64.deb -o /tmp/basebuild.deb && sudo apt install /tmp/basebuild.deb
```

The Linux AppImage may require your distribution's FUSE 2 compatibility
package. Debian/Ubuntu users should prefer the `.deb`.

> **Package managers:** Basebuild is not yet published in the Winget,
> Homebrew Cask, Snap, Flatpak, or distribution package catalogs. Do not use an
> unofficial package as though it were maintained by this project. Once an
> official catalog entry exists, its exact `winget`, `brew`, or Linux command
> will be added here.

Remote-script one-liners execute the script from the default branch. Review
[`install.ps1`](./install.ps1) or [`install.sh`](./install.sh) first, or replace
`main` in the raw URL with a trusted commit SHA. Direct downloads are available
on the [latest release](https://github.com/basebuild-net/basebuild/releases/latest).

## Quick start (source development)

This repository contains the desktop application's source. Running only the
Vite dev server (`npm run dev`) renders a non-functional preview because
terminals, source control, and SQLite require the Rust Tauri backend.

```bash
npm install
npm run tauri dev
```

Development requires Node.js 20+, stable Rust, and the native C/C++ toolchain
for your operating system.

## Packaging locally

Run the command for the host platform:

```powershell
# Windows x64 — NSIS
npm run tauri build -- --bundles nsis
```

```bash
# Linux x64 — AppImage + Debian package
npm run tauri build -- --bundles appimage,deb

# macOS universal — install both Rust targets once, then build
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin --bundles app,dmg
```

Platform prerequisites and output locations are documented in
[`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md).

## Releasing

Releases are manual, draft-first, and built only by the
[`CI / Release`](./.github/workflows/ci-release.yml) workflow. Dispatch it with
an unpublished semantic version, wait for the Windows/Linux/macOS matrix and
final manifest verification, review the draft release, then publish it. Do not
pre-bump version files, create a release tag manually, or upload hand-built
artifacts.

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
