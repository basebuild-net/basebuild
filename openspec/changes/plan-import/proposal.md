# Proposal: Plan Import

## Why

Projects often already contain planning work the app never created — most
commonly unexecuted OpenSpec changes under `openspec/changes/<slug>/`, but also
user-authored plans. `basebuild-planning-skill` (PR #20) gave `.basebuild/plans/`
a portable record format with an `external` pointer for exactly this case. This
change lets the app **import** those pre-existing external plans into
`.basebuild` plan records so they show up as first-class, trackable plans instead
of being stranded on disk.

## What Changes

- **Detect** importable external plans in the project (e.g.
  `openspec/changes/<slug>/` folders not linked to any plan) and present them as
  candidates without modifying them.
- On explicit confirm, **write** `.basebuild/plans/<slug>/plan.md` records with
  `engine` (detected, e.g. `openspec`), `external` (source path), a **derived
  status**, and a title from the source — no duplicate task list for external
  engines.
- Imported plans surface in the app planning workspace.
- Import is **confirmed** (no silent writes), **idempotent** (skip already-linked
  sources, never overwrite user edits), and **safe** (report + skip malformed
  sources rather than guessing).

## Capabilities

### New Capabilities
- `plan-import`: detect external plan artifacts, import them into `.basebuild`
  plan records, and do so safely/idempotently with confirmation.

### Modified Capabilities
- (none canonical) — writes records per `planning-file-schema` (unarchived
  `basebuild-planning-skill`) and registers plans in the `plan-pipeline`
  workspace without changing their requirements.

## Impact

- **Rust:** add `src-tauri/src/services/plan_import_service.rs` (or extend
  `openspec_service.rs` + `plan_service.rs`) to scan `openspec/changes/`, read
  proposal titles, derive status from `tasks.md` progress, and write
  `.basebuild/plans/<slug>/plan.md` per the schema; add a `plan_import` command
  and register it.
- **Frontend:** add `src/lib/planImport.ts` (thin wrappers) and an import view
  (candidate list + confirm) surfaced from the planning inspector; 0px radius,
  `title` tooltips.
- **Pairing:** with `planning-file-ingestion` — once a plan is imported to
  `.basebuild/plans/`, ingestion surfaces it in the workspace; plan-import MAY
  reuse that path to register the app row rather than duplicating it.
- **Tests/verification:** `cargo test` for candidate detection, status
  derivation, idempotency, and malformed-source skip; `npx tsc --noEmit`;
  `npm run build`; UI smoke importing an existing OpenSpec change.
