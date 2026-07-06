# Design: Plan Status Rename (openspec → planned)

## Context

Plan status lives in `src-tauri/src/models/plan.rs` as `PlanStatus` (variant
`Openspec`, string `"openspec"`), with a precedent migration mapping legacy
`waiting`/`in_progress` on read and startup. The frontend mirrors it in
`src/lib/plans.ts` (`PlanStatus` union, `PLAN_STATUSES`, `PLAN_STATUS_LABEL`).
The `.basebuild` planning-file schema (`planning-file-schema`) already specifies
`draft → planned → ready → running → finished`; `planned` is engine-agnostic,
while `openspec` implies a specific artifact type. This change aligns the app to
the schema so file interop (`planning-file-ingestion`, `plan-import`) is clean.

## Goals / Non-Goals

**Goals**:
- Single canonical post-draft status `planned` across DB, API, and UI.
- Lossless migration + backward-compatible parsing (no data loss, no unknowns).
- Vocabulary parity with the `.basebuild` schema and AGENTS.md.

**Non-Goals**:
- Renaming the OpenSpec artifact type or the `openspec-artifacts` generation
  stage — the *engine/type* stays; only the plan *status* changes.
- Any behavior change to the generation, ready gate, or run handoff beyond the
  status label.

## Decisions

- **Decision**: Migrate `openspec → planned` once on startup, mirroring the
  existing `waiting`/`in_progress` migration path in `storage_service.rs`. —
  **Rationale**: one proven mechanism; idempotent. **Alternatives**: lazy migrate
  on read only (leaves stale values in the DB indefinitely).
- **Decision**: Keep parsing `"openspec"` as an accepted alias that normalizes to
  `Planned`. — **Rationale**: defends against stale rows and external writers
  (planning files) during the transition. **Alternatives**: hard-reject legacy
  values (fragile, crashes on old data).
- **Decision**: Treat this as internal pre-1.0 breaking on the API surface (no
  `openspec` status returned) but non-breaking for stored data (migration + alias
  absorb it). — **Rationale**: no shipped external consumers; keeps the surface
  clean. **Alternatives**: dual-emit both values (perpetuates the ambiguity).

## Risks / Trade-offs

- A missed status literal in code/UI → Mitigation: enum + union are the single
  sources; grep `openspec`-as-status callsites during apply; the read alias
  catches stragglers at runtime.
- Docs drift → Mitigation: AGENTS.md Invariant 9 + config.yaml updated in the
  same change; verification checks them.

## Migration Plan

1. Rename enum variant + string maps; keep `"openspec"` accepted on parse.
2. Add the one-time startup migration `openspec → planned`.
3. Update frontend union/labels/filters.
4. Update AGENTS.md Invariant 9 + `openspec/config.yaml`.
Rollback: revert the change; migrated `planned` rows still parse (the schema
already includes `planned`), so downgrade is safe.

## Open Questions

None.
