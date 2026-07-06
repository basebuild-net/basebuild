# Tasks: Planning File Ingestion

## 1. File Reader & Parser

- [ ] 1.1 Add `src-tauri/src/services/planning_files_service.rs` to locate `.basebuild/`, read `categories.md`, `ideas/<slug>.md`, and `plans/<slug>/plan.md`, and parse YAML frontmatter + body.
- [ ] 1.2 Define a mapping from file frontmatter fields and the file status vocabulary (`planned`, …) to `models/plan.rs` / `models/idea.rs`.

## 2. Reconciliation & Upsert

- [ ] 2.1 Upsert categories, ideas, and plans through `src-tauri/src/services/plan_service.rs` keyed by slug, with content-hash/mtime gating so unchanged records are not rewritten (idempotent).
- [ ] 2.2 Skip malformed/missing-frontmatter files, collecting warnings; never abort the whole scan on one bad file.
- [ ] 2.3 Preserve file authority: ingestion reads only; it never writes back to `.basebuild/`.

## 3. Wiring & UI

- [ ] 3.1 Add a scan command (in `commands/plans.rs` or a new module), register it, and call it from the project-open path in `project_service.rs`.
- [ ] 3.2 Add `src/lib/planningFiles.ts` thin wrappers and a rescan action; ensure the `Plans / Ideas / Categories` inspector reflects ingested records and surfaces warnings compactly (`title` tooltips, 0px radius).

## 4. Verification

- [ ] 4.1 `cargo test` in `src-tauri`: frontmatter parsing, field/status mapping, upsert idempotency, external-edit reconciliation, malformed-file skip.
- [ ] 4.2 `npx tsc --noEmit`
- [ ] 4.3 `npm run build`
- [ ] 4.4 UI smoke: open a project with file-authored `.basebuild` plans/ideas/categories; confirm they appear; edit a file, rescan, confirm the update; confirm no duplicates.
- [ ] 4.5 Update `docs/agents/*` describing ingestion behavior and file authority.

## 5. Docs & Roadmap

- [ ] 5.1 Refresh `openspec/ROADMAP.md` via `node scripts/openspec-status.mjs --write`.
