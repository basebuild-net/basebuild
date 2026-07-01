# Basebuild

A desktop control plane for AI coding agents.

Basebuild wraps [OhMyPi (OMP)](https://github.com/oh-my-pi) in a local-first,
cross-platform desktop app. It gives your agent a visual project workspace,
source control, and a persistent plan pipeline so you can turn a goal into
scoped work without leaving the app.

## Features

- **Plan pipeline** — generate, prioritize, and track MVP plans in a right-side
  panel. Plans flow through `draft → openspec → waiting → in_progress → finished`.
- **Integrated terminal** — real PTY-backed terminals backed by
  [portable-pty](https://github.com/wez/wezterm/tree/main/portable-pty) and
  rendered with [xterm.js](https://xtermjs.org/).
- **Source control** — Git status, diff, stage, commit, and history using the
  installed Git CLI.
- **Agent-aware context** — copy a plan reference id or open a plan directly in
  a terminal session so the agent knows exactly what to work on.
- **Local-first storage** — SQLite for dynamic state, OpenSpec files for plans,
  no cloud dependency.

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

- [`AGENTS.md`](./AGENTS.md) — agent guide, design system, and code conventions.
- [`DESIGN.md`](./DESIGN.md) — Basebuild Mono Desktop visual design system.
- [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) — development notes, architecture, and build scripts.
- [`docs/SECRETS.md`](./docs/SECRETS.md) — release signing and infrastructure secrets.
- [`openspec/`](./openspec/) — OpenSpec planning artifacts.

## Contributing

Contributions are welcome. Please read [`AGENTS.md`](./AGENTS.md) before making
changes — it describes the design system, project structure, and conventions
used across the codebase.

## License

Attribution-required license — feel free to use, improve, and distribute, but
you must credit basebuild.net. Taking code or assets without attribution is
prohibited. See [`LICENSE`](./LICENSE) for full terms.
