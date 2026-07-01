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

## Quick start

```bash
npm install
npm run tauri dev
```

You need:

- Node.js 20+
- Rust (stable)
- Visual Studio C++ Build Tools (Windows) or equivalent C++ toolchain

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

MIT — see [`LICENSE`](./LICENSE) for details.
