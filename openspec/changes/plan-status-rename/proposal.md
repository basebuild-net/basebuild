# Proposal: Plan Status Rename (openspec → planned)

## Why

The app's plan lifecycle uses `draft → openspec → ready → running → finished`,
but the portable `.basebuild` planning-file schema (`basebuild-planning-skill`,
PR #20) defines the same stage as **`planned`** — engine-agnostic, since a plan
can be "planned" via native artifacts or any detected planning skill, not only
OpenSpec. Keeping the app on `openspec` blocks clean file interop and mislabels
non-OpenSpec plans. This renames the status to `planned` across DB, APIs, and UI,
with a one-time migration.

## What Changes

- Rename the plan status value `openspec → planned` in the DB model, all Tauri
  command payloads, and the UI (label "Planned").
- Add a **one-time startup migration** rewriting `openspec` rows to `planned`
  (alongside the existing `waiting → ready` / `in_progress → running`
  migrations), run exactly once.
- Keep a **backward-compatible read alias**: a stored or incoming `openspec`
  value normalizes to `planned` rather than erroring.
- Update the status vocabulary in **AGENTS.md Invariant 9** and
  `openspec/config.yaml` to `draft → planned → ready → running → finished`.
- The OpenSpec artifact **engine/type name stays** — only the plan *status*
  changes; `openspec-artifacts` still generates `openspec/changes/…`.
- **BREAKING (internal, pre-1.0):** the `openspec` status value is removed from
  the API surface; the migration + read alias absorb existing data.

## Capabilities

### New Capabilities
- `plan-status-migration`: one-time `openspec → planned` migration, backward-
  compatible parsing, and UI/vocabulary alignment.

### Modified Capabilities
- `plan-pipeline`: "Plan lifecycle statuses" now reads `draft → planned → …` and
  migrates `openspec`.
- `openspec-artifacts`: the generation stage and ready gate now move plans
  `draft → planned` and `planned → ready` (artifact type unchanged).

## Impact

- **Rust:** rename `PlanStatus::Openspec → PlanStatus::Planned` and its string
  maps in `src-tauri/src/models/plan.rs` (keep `"openspec"` accepted on parse,
  normalized to `planned`); update the generation stage in `pipeline_service.rs`
  / `openspec_service.rs` and any status checks in `plan_service.rs`; add the
  one-time migration in `storage_service.rs`.
- **Frontend:** update the `PlanStatus` union, `PLAN_STATUSES`, and
  `PLAN_STATUS_LABEL` in `src/lib/plans.ts`; update `src/state/plans.ts` and any
  status badge/filter components (label "Planned").
- **Docs:** AGENTS.md Invariant 9, `openspec/config.yaml` lifecycle line, and
  `docs/agents/*` where the status is documented.
- **Tests/verification:** `cargo test` for migration idempotency + alias parsing;
  `npx tsc --noEmit`; `npm run build`; UI smoke that plans render "Planned".
