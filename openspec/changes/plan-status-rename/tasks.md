# Tasks: Plan Status Rename (openspec → planned)

## 1. Backend Rename & Migration

- [ ] 1.1 Rename `PlanStatus::Openspec → PlanStatus::Planned` in `src-tauri/src/models/plan.rs`; map it to/from the string `"planned"`, and keep `"openspec"` accepted on parse (normalized to `Planned`).
- [ ] 1.2 Update status checks/transitions in `src-tauri/src/services/plan_service.rs`, `pipeline_service.rs`, and `openspec_service.rs` (generation stage sets `planned`; ready gate is `planned → ready`).
- [ ] 1.3 Add a one-time startup migration in `src-tauri/src/services/storage_service.rs` rewriting `openspec` rows to `planned`, idempotent, alongside the existing `waiting`/`in_progress` migration.

## 2. Frontend Rename

- [ ] 2.1 Update the `PlanStatus` union, `PLAN_STATUSES`, and `PLAN_STATUS_LABEL` (label "Planned") in `src/lib/plans.ts`.
- [ ] 2.2 Update `src/state/plans.ts` and any status badge/filter components to render "Planned"; remove the "OpenSpec" status option.

## 3. Vocabulary & Docs

- [ ] 3.1 Update AGENTS.md Invariant 9 to `draft → planned → ready → running → finished`.
- [ ] 3.2 Update the lifecycle line in `openspec/config.yaml` and any `docs/agents/*` that document the plan status.

## 4. Verification

- [ ] 4.1 `cargo test` in `src-tauri`: migration rewrites `openspec → planned` exactly once and is idempotent; parser normalizes legacy `openspec`; other fields preserved.
- [ ] 4.2 `npx tsc --noEmit`
- [ ] 4.3 `npm run build`
- [ ] 4.4 UI smoke: an existing/generated plan shows the "Planned" badge; filters list "Planned"; no "OpenSpec" status remains.

## 5. Docs & Roadmap

- [ ] 5.1 Refresh `openspec/ROADMAP.md` via `node scripts/openspec-status.mjs --write`.
