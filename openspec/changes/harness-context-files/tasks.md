# Tasks: Harness Context Files

## 1. Discovery Service

- [ ] 1.1 `context_service.rs`: AGENTS.md ancestor walk (project dir → repo root, dot-dirs skipped), CLAUDE.md per-level fallback, schematic read via `schematic_service`; `AssembledContext`/`ContextPart` models.
- [ ] 1.2 Mtime-keyed cache with lazy invalidation on session create and manual refresh.
- [ ] 1.3 Rust unit tests: walk-up ordering, CLAUDE.md fallback, dot-dir skipping, non-git project, cache invalidation.

## 2. Assembly & Injection

- [ ] 2.1 Fixed-order assembly (base, schematic, context files root-first, skills metadata) with per-part token estimates and head-truncation markers at configurable caps.
- [ ] 2.2 Inject at session create in `native_chat_service.rs`; report part tokens into the `native-agent-loop` budget accounting; skills listed as name + description only.
- [ ] 2.3 Per-project settings (source toggles, caps) in `settings_service.rs` + Settings UI section.
- [ ] 2.4 Rust tests: deterministic assembly, cap truncation, toggle omission, budget reporting.

## 3. Visibility UI

- [ ] 3.1 Context inspection commands + `src/lib/context.ts` wrappers (list parts, refresh).
- [ ] 3.2 Inspector UI in `ChatPanel.tsx`: per-part source/tokens/truncated/stale/disabled, total, refresh action; transcript system row on refresh; tooltips; styles in `globals.css`.
- [ ] 3.3 Frontend tests (mocked Tauri): inspector rendering, stale indicator, refresh flow.

## 4. Verification & Docs

- [ ] 4.1 Smoke: session in this repo shows AGENTS.md + schematic + skills in inspector; edited AGENTS.md appears in next session without restart.
- [ ] 4.2 `npx tsc --noEmit`, `npm run build`, `cargo check`, `cargo test`.
- [ ] 4.3 Update `docs/agents/agent-runtime.md` (assembly order, toggles, caps); refresh roadmap via `node scripts/openspec-status.mjs --write`.
