# Design: Planning File Ingestion

## Context

`planning-file-schema` defines `.basebuild/categories.md`, `ideas/<slug>.md`
(YAML frontmatter + body), and `plans/<slug>/plan.md` (+ `tasks.md` for native
engines) as the portable, git-committable planning source of truth. The app
stores the same concepts in SQLite (`models/plan.rs`, `models/idea.rs`) surfaced
by the `plan-pipeline-ui` inspector. Nothing currently reads the files into the
app, so file-authored or teammate-authored planning is invisible.

## Goals / Non-Goals

**Goals**:
- One-way ingestion (files → workspace) that keeps files authoritative.
- Reflect external edits idempotently and non-destructively.
- Robustness: never crash on malformed files; surface, skip, continue.

**Non-Goals**:
- Writing app state back to files (that's the schema's/skill's job; a future
  two-way sync is out of scope here).
- Redefining the file schema or the workspace model.
- Live file-watching — scan on open + on demand is sufficient for now.

## Decisions

- **Decision**: A dedicated `planning_files_service.rs` reads/parses the tree and
  upserts through `plan_service.rs`. — **Rationale**: parsing/reconciliation is
  its own concern; the plan service stays the single DB authority.
  **Alternatives**: inline parsing in commands (spreads DB writes, hard to test).
- **Decision**: Reconcile by slug identity + content hash; update only changed
  records. — **Rationale**: idempotent, cheap rescans, stable inspector.
  **Alternatives**: wipe-and-reinsert (loses app-only fields, churns the UI).
- **Decision**: Files are authoritative; the app never overwrites a file during
  ingestion. — **Rationale**: matches the schema's source-of-truth contract and
  avoids clobbering git-tracked user edits. **Alternatives**: two-way merge (race
  conditions, conflict UX — deferred).
- **Decision**: Map file `planned` to the app's post-draft status. — **Rationale**:
  aligns with `plan-status-rename`; if that hasn't landed, map to the current
  post-draft value. **Alternatives**: introduce a separate status (fragments the
  vocabulary).

## Risks / Trade-offs

- Slug/status skew between file schema and app → Mitigation: explicit mapping
  table; unknown statuses skipped with a warning.
- Large `.basebuild/` trees → Mitigation: hash-gated updates; scan is O(files)
  with no rewrite when unchanged.

## Migration Plan

Additive. Existing app-created records are untouched when no files exist; ingestion
augments/reconciles when files are present.

## Open Questions

- Conflict policy when a workspace record and its file diverge and both changed —
  default: file wins (source of truth); revisit if two-way sync is added.
