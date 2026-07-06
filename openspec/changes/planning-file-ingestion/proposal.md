# Proposal: Planning File Ingestion

## Why

`basebuild-planning-skill` (PR #20) defined the portable `.basebuild/` planning
file schema (`categories.md`, `ideas/<slug>.md`, `plans/<slug>/`), and
`unified-planning-workspace` (PR #20) shipped the app's `Plans / Ideas /
Categories` inspector backed by SQLite. Today those two worlds do not meet: plans
authored on disk (by the skill, another machine, or a teammate via git) are
invisible in the app. This change makes the app **read and sync** `.basebuild`
planning files into the workspace so file-authored planning shows up natively.

## What Changes

- On project open and on explicit **rescan**, the app scans `.basebuild/` and
  ingests categories, ideas, and plans into the SQLite planning workspace.
- Map file frontmatter to workspace records; map the file status vocabulary
  (`planned`, …) to the app's plan/idea vocabulary.
- **Non-destructive reconciliation**: detect external edits (content hash /
  mtime), update workspace records to match, never clobber user file edits —
  files remain the source of truth per the schema.
- Skip malformed/unknown-frontmatter files with a surfaced warning; ingestion is
  **idempotent** (no duplicate records on rescan).

## Capabilities

### New Capabilities
- `planning-file-ingestion`: scan + ingest `.basebuild` planning files, field/
  status mapping, and non-destructive idempotent reconciliation.

### Modified Capabilities
- (none canonical) — consumes `planning-file-schema` (unarchived
  `basebuild-planning-skill`) and populates the `plan-pipeline` /
  `plan-pipeline-ui` workspace without changing their requirements.

## Impact

- **Rust:** add `src-tauri/src/services/planning_files_service.rs` to read/parse
  `.basebuild/categories.md`, `ideas/`, and `plans/` (YAML frontmatter) and upsert
  via `plan_service.rs` into `models/plan.rs` / `models/idea.rs`; add a scan
  command (`commands/plans.rs` or a new module) and a project-open hook in
  `project_service.rs`.
- **Frontend:** add `src/lib/planningFiles.ts` (thin wrappers) + a rescan action;
  the `Plans / Ideas / Categories` inspector reflects ingested records
  (`plan-pipeline-ui`); surface ingestion warnings compactly.
- **Ordering:** depends on `plan-status-rename` for the `planned` status mapping;
  if that has not landed, map `planned` (file) ↔ the app's post-draft status.
- **Tests/verification:** `cargo test` for frontmatter parsing, upsert
  idempotency, external-edit reconciliation, and malformed-file skip; `npx tsc
  --noEmit`; `npm run build`; UI smoke opening a project with file-authored plans.
