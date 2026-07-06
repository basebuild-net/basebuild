# Agent Documentation Index

This directory contains detailed agent and contributor workflow docs for
Basebuild. Root `AGENTS.md` is the mandatory entry point — it links here.

## When to read each document

| Document | Read when... |
|---|---|
| [`openspec.md`](./openspec.md) | Starting, applying, or archiving an OpenSpec change |
| [`testing.md`](./testing.md) | Verifying a change before yielding |
| [`workflow.md`](./workflow.md) | Branching, committing, doc upkeep, or the pre-yield checklist |
| [`design-system.md`](./design-system.md) | Changing UI, CSS, layout, or visual conventions |
| [`agent-runtime.md`](./agent-runtime.md) | Changing chat, terminal, OMP, adapters, permissions, analytics, or defaults |
| [`desktop-shell.md`](./desktop-shell.md) | Changing tabs, panels, workspace routing, or session state |

## Quick reference

- **Project purpose**: Basebuild is a local-first desktop wrapper around OMP and terminal-based coding tools.
- **Stack**: Tauri (Rust backend), React + TypeScript frontend, SQLite local state.
- **Design contract**: `DESIGN.md` is canonical. `src/styles/globals.css` is the only stylesheet.
- **OpenSpec**: Changes live in `openspec/changes/<name>/`. Apply with the `/apply` skill.
- **Privacy**: Analytics disabled by default. No phone-home. See [`agent-runtime.md`](./agent-runtime.md).
