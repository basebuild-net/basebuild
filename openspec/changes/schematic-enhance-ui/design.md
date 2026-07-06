# Design: Schematic Enhance UI

## Context

The schematic wizard (`schematic-grounded-planning`, PR #22) renders each
schematic section as a card and runs create/edit/re-align flows as visible,
approval-gated chat turns via `schematic_service.rs`. The wizard spec includes an
"AI-enhanced descriptions" requirement (its task 2.3) that was never implemented
in code. This change fills exactly that gap; it reuses the existing wizard turn
and approval-gated write mechanism rather than inventing a new one.

## Goals / Non-Goals

**Goals**:
- Per-section, one-click rewrite of plain text into agent-optimized text.
- Approval-gated before/after diff; no silent replacement of user prose.
- Consistent with the wizard's visible-turn and write-on-approval behavior.

**Non-Goals**:
- Bulk/whole-document enhancement (per-section only).
- Changing the schematic template, section set, or health validation.
- Any new provider or model plumbing beyond the existing turn mechanism.

## Decisions

- **Decision**: Reuse the schematic wizard's edit-turn path (target one section,
  preserve the rest) and return a *proposed* rewrite to the UI instead of writing.
  — **Rationale**: the "edit (per section)" flow already targets a single section
  and gates writes on approval; Enhance is that flow with a rewrite prompt and a
  diff surface. **Alternatives**: a standalone one-shot completion (loses the
  visible-turn consistency and the tool-loop grounding).
- **Decision**: The diff is computed and rendered in the frontend from
  `{ before, after }` returned by the command. — **Rationale**: keeps the write
  atomic and on approval only; the backend never mutates the file during preview.
  **Alternatives**: write-then-revert (risks partial writes / mtime churn).
- **Decision**: Gate the control on model tool/agent capability. — **Rationale**:
  matches the wizard's requirement that turns need a tool-capable model; avoids
  starting a turn that fails midway. **Alternatives**: always enabled with a
  runtime error (worse UX, violates the safe-degradation intent).

## Risks / Trade-offs

- Rewrite drifts from the user's meaning → Mitigation: prompt preserves meaning
  and language; the diff makes drift visible before any write.
- Occasional long turns → Mitigation: the control shows a proposing/cancellable
  state; cancel leaves text untouched.

## Migration Plan

None — additive UI + one new command. No schema or file-format change.

## Open Questions

None.
