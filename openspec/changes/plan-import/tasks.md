# Tasks: Plan Import

## 1. Detection

- [ ] 1.1 Add `src-tauri/src/services/plan_import_service.rs` to scan `openspec/changes/` for change folders and read each `proposal.md` title + `tasks.md` progress.
- [ ] 1.2 Dedupe candidates against existing `.basebuild/plans/*/plan.md` records by `external` path (skip already-linked).

## 2. Import

- [ ] 2.1 Derive status conservatively (`planned` when artifacts complete; advance only when `tasks.md` progress clearly implies it).
- [ ] 2.2 Write `.basebuild/plans/<slug>/plan.md` per `planning-file-schema` with `engine: openspec`, `external: openspec/changes/<slug>/`, derived status, and title; no duplicate task list; suffix slug on collision.
- [ ] 2.3 Register/surface imported plans in the app workspace (reuse `planning-file-ingestion` where available rather than double-writing).

## 3. Command & UI

- [ ] 3.1 Add a `plan_import` command (detect + confirm-import) and register it.
- [ ] 3.2 Add `src/lib/planImport.ts` thin wrappers and an import view (candidate list + explicit confirm) surfaced from the planning inspector; `title` tooltips, 0px radius; report skipped/malformed sources compactly.

## 4. Verification

- [ ] 4.1 `cargo test` in `src-tauri`: candidate detection, dedupe by `external`, status derivation, idempotent re-import, malformed-source skip.
- [ ] 4.2 `npx tsc --noEmit`
- [ ] 4.3 `npm run build`
- [ ] 4.4 UI smoke: import an existing `openspec/changes/<slug>/`; confirm the plan appears with `engine: openspec` + `external`; re-run import and confirm it is skipped.
- [ ] 4.5 Update `docs/agents/*` describing import detection + confirmation.

## 5. Docs & Roadmap

- [ ] 5.1 Refresh `openspec/ROADMAP.md` via `node scripts/openspec-status.mjs --write`.
