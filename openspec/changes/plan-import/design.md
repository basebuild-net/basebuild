# Design: Plan Import

## Context

`planning-file-schema` specifies external-engine plan records:
`plans/<slug>/plan.md` with `engine: <skill>` and `external: <path>` (e.g.
`openspec/changes/<slug>/`), no duplicated task list, status owned by the record.
`openspec-artifacts` describes what an OpenSpec change folder contains
(`proposal.md`, `specs/`, `tasks.md`, `.openspec.yaml`). Projects frequently hold
such changes that were authored before the app tracked them; there is no path to
bring them under app management today.

## Goals / Non-Goals

**Goals**:
- Turn pre-existing external plan artifacts into tracked `.basebuild` plan
  records with correct `engine`/`external`/`status`.
- Confirmed, idempotent, non-destructive import; robust to malformed sources.

**Non-Goals**:
- Executing imported plans or generating artifacts (that's the run pipeline).
- Rewriting or "adopting" the external artifacts — they stay where they are; the
  record only points at them.
- Importing from remote sources — local project tree only.

## Decisions

- **Decision**: Detect candidates by scanning `openspec/changes/` for folders not
  already referenced by a `.basebuild` plan `external` path. — **Rationale**: the
  `external` pointer is the natural dedupe key; keeps import idempotent.
  **Alternatives**: track imports in a side table (redundant with the record).
- **Decision**: Write the `.basebuild/plans/<slug>/plan.md` record as the import
  output and let the workspace pick it up (reuse `planning-file-ingestion`). —
  **Rationale**: one source of truth (the file), no double-write drift.
  **Alternatives**: write only a DB row (diverges from the portable schema).
- **Decision**: Derive status conservatively — `planned` when artifacts are
  complete; advance only when `tasks.md` progress clearly implies it. —
  **Rationale**: avoid over-claiming state; the user can advance manually.
  **Alternatives**: always `planned` (loses obvious in-progress signal) or guess
  aggressively (mislabels).
- **Decision**: Require an explicit confirm step listing candidates. — **Rationale**:
  no silent side effects (Invariant); import writes files. **Alternatives**:
  auto-import on open (surprising writes to a git-tracked tree).

## Risks / Trade-offs

- Slug collision with existing records → Mitigation: dedupe on `external` path;
  suffix slug per the schema's collision rule if needed.
- Misparsed title/status → Mitigation: malformed sources are reported and
  skipped; status derivation is conservative and user-adjustable.

## Migration Plan

Additive. No schema change; import only writes new `.basebuild/plans/` records for
confirmed candidates and never touches the source artifacts.

## Open Questions

- Whether to detect non-OpenSpec external plan shapes in this change — start with
  OpenSpec changes; the detector is pluggable for later engines.
