# Design: Basebuild Desktop Local Foundation

## Context

`basebuild-app` is the desktop frontend application for Basebuild. It should be local-first, Windows-first, and focused on managing local projects, OMP sessions, terminal panes, source control, modular Basebuild configs, and update readiness. The repo should not implement basebuild.net login, cloud sync, D1 schema, or backend services in this change.

OMP already exposes a structured RPC mode via `omp --mode rpc`, so the desktop app should host OMP over JSONL stdio rather than scraping terminal output. Tauri v2 provides a small native desktop shell with a Rust core capable of owning long-lived child processes, PTYs, filesystem access, and update checks.

## Goals / Non-Goals

**Goals**:
- Establish the Windows-first Tauri desktop foundation.
- Use React, TypeScript, Vite, and Tailwind for a clean custom dark UI.
- Own process, PTY, Git, filesystem, storage, config-pack, and update services in Rust.
- Use installed `git` CLI for Source Control.
- Provide global and project `.basebuild/` storage conventions.
- Provide built-in and user-created config/prompt packs with manual update readiness.
- Provide a shared Updates & Requirements UI for dependencies and updates.
- Design app update metadata to fit Tauri updater, GitHub Actions, and Cloudflare Worker/R2/D1 hosting later.

**Non-Goals**:
- No basebuild.net login or cloud sync.
- No D1 schema/API implementation in this repo.
- No GitHub Issues, PRs, code review, or GitHub auth workflows.
- No macOS distribution/signing/notarization.
- No Windows Authenticode requirement.
- No automatic app updates or automatic config-pack updates.
- No git2/gix embedded Git implementation in v1.

## Decisions

**Decision**: Use Tauri v2 for the desktop shell. — **Rationale**: Tauri gives a small native desktop app, Rust process control, native dialogs, and updater support while avoiding Electron's bundled Chromium footprint. **Alternatives**: Electron was considered but is heavier and unnecessary for this local-first app.

**Decision**: Use Vite + React + TypeScript + Tailwind for the webview UI. — **Rationale**: Vite is only the frontend build tool and produces static assets for Tauri. React/TypeScript/Tailwind match existing Basebuild web conventions while avoiding a server-rendered desktop stack. **Alternatives**: Next.js is unnecessary because there is no desktop SSR/server runtime; Svelte/Solid would work but increase context switching.

**Decision**: Spawn OMP from Rust using a long-lived RPC service. — **Rationale**: Rust should own the child process, JSONL framing, restart behavior, and event emission. This avoids broad frontend shell permissions and avoids terminal scraping. **Alternatives**: Running OMP in an embedded terminal would lose structured state; using frontend shell APIs would make lifecycle management weaker.

**Decision**: Use `portable-pty` with xterm.js for terminal panes. — **Rationale**: `portable-pty` is cross-platform and part of WezTerm. xterm.js is the standard terminal renderer in webviews. **Alternatives**: Native terminal widgets do not fit the custom webview UI; shell output without a PTY breaks interactive CLIs.

**Decision**: Use installed `git` CLI for Source Control. — **Rationale**: Git CLI respects the user's installed Git configuration and credential helpers, especially on Windows. Porcelain output supports tool parsing. **Alternatives**: git2/libgit2 and gix add complexity and credential behavior differences that are not needed for v1.

**Decision**: Model missing dependencies and updates through one Updates & Requirements service. — **Rationale**: Git installation, app updates, config-pack updates, and future plugin/skill updates all produce the same user question: something needs attention. One panel and badge avoids scattered UI. **Alternatives**: Separate update and dependency panels would duplicate logic and confuse priority.

**Decision**: Use TOML/Markdown for editable config packs and SQLite for dynamic app state. — **Rationale**: TOML and Markdown are human-editable and source-control-friendly for prompts/workflows. SQLite is appropriate for recent projects, idea history, runs, installed pack metadata, and app events. **Alternatives**: Storing everything in SQLite would make prompts harder to edit/share; storing runtime state only in files would make queries and history harder.

**Decision**: Design updater support around Cloudflare Worker/R2/D1 compatibility, not private GitHub Releases as the direct updater endpoint. — **Rationale**: The repo may remain private, and direct private GitHub release assets create auth problems for desktop updater flows. GitHub Actions can still build artifacts and upload them to Cloudflare. **Alternatives**: Direct GitHub Releases are simpler if the repo becomes public later, but should not be the only design.

## Risks / Trade-offs

- Git CLI output parsing can be fragile → Mitigation: use parseable commands such as `git status --porcelain=v2 -z --branch` and isolate parsing in `GitService`.
- Tauri updater requires artifact signatures before one-click install works → Mitigation: implement update-check UI first and enable install only when signing/artifact hosting are configured.
- Windows-first behavior may hide Linux issues → Mitigation: keep platform-specific services abstracted and add Linux verification after Windows foundation works.
- Config packs can affect agent behavior and are supply-chain sensitive → Mitigation: no silent updates, version pinning, review-before-update, and built-in offline official packs.
- OMP process lifecycle can fail or hang → Mitigation: explicit ready-frame timeout, process status events, restart/stop commands, and visible error states.

## Migration Plan

1. Create the initial Tauri app scaffold and local storage conventions.
2. Add the Rust service boundaries and frontend shell layout.
3. Implement requirements detection before dependent UI features rely on Git or OMP.
4. Add OMP RPC and terminal services.
5. Add Source Control using the installed Git CLI.
6. Add config-pack models and built-in official pack.
7. Add update-check abstractions and Cloudflare-compatible metadata models.
8. Enable release/update installation only after signing keys and artifact hosting are configured.

Rollback strategy is simple during the foundation phase: each service is local and can be disabled behind UI availability checks. No remote data migrations are part of this change.

## Open Questions

- Should global Basebuild storage be exactly `~/.basebuild/` on Windows, or should the implementation use the platform app-data directory while exposing/importing `.basebuild` project config? Current preference is to support `~/.basebuild/` for user-visible config and use platform app data only for opaque cache if needed.
- Which first official config packs should ship beyond the default idea-generation pack?
- Should OMP itself be treated as a required dependency or recommended dependency in the first UI pass?
