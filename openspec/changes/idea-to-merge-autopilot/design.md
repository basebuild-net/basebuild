# Design: Idea-to-Merge Autopilot

## Context

The canonical specs already define every stage of the loop the owner wants:
grounded agentic idea generation with a decision digest
(`grounded-generation`), batch promotion and batch launch with destination
mapping (`planning-flow-board`, `plan-chat-assignment`), worktree-isolated
runs (`parallel-workspaces`), live run progress (`plan-completion-flow`), an
integration queue with confirm-gated merge/cleanup (`plan-merge-cleanup`),
and dependency/collision scheduling (`plan-dependency-scheduling`). What is
missing is the connective tissue: each stage must be invoked by hand, with
typing, from different surfaces, and nothing estimates when work will land.
This change adds the orchestration layer without new git plumbing or new
generation machinery.

The 2026-07-08 live audit items in `mvp.md` (course-correction checklist)
remain unchecked; the owner has not re-tested recently. A live baseline audit
is therefore the first task phase — findings feed implementation instead of
assumptions.

## Goals / Non-Goals

**Goals**:
- One-click idea rounds: zero required input, grounded in schematic + digest
  + preferences; round review with single-confirmation bulk deploy.
- Mission control: per-run cards with owner chat, progress, blockers,
  attention states, and an honest task-velocity completion estimate.
- Guided multi-run merge review sessions over the integration queue.
- Per-project post-finish policy (`hold` / `auto_commit` / `auto_commit_pr` /
  `queue_merge_review`).
- End-to-end worktree lifecycle verification.

**Non-Goals**:
- Cross-project orchestration or portfolio views.
- ML/complex estimation — linear task velocity only.
- Automatic merges into the default branch (never, under any policy).
- Replacing `diff-review-workflow` — sessions link to its per-run diff
  surface as it lands; until then the existing changed-file summary is the
  review affordance.
- New idea-generation prompt machinery — rounds reuse the existing grounded
  agentic turn end to end.

## Decisions

**Decision**: Rounds reuse the existing generation batch id already persisted
on ideas (idea grounding metadata / batch header landed with
`chat-experience-completion`) as the round identity. — **Rationale**: no new
tables or migration for round membership; history is a filtered view.
**Alternatives**: a dedicated `rounds` table (adds migration + sync surface
for what a `GROUP BY batch_id` answers).

**Decision**: Completion estimate = linear projection from observed
task-completion velocity: `remaining_tasks / (completed_ticks / elapsed)`,
using the median inter-tick interval once ≥2 ticks exist, updating per tick,
display-only. — **Rationale**: honest, explainable, zero dependencies;
labeled as an estimate so noise is acceptable. **Alternatives**: provider
token-rate models (opaque, provider-coupled), static per-plan guesses
(fabricated precision).

**Decision**: Post-finish policy is stored with the project's launch profile
(same storage row/service that owns worker count and workspace policy) and
applied inside the plan run service's finish transition. — **Rationale**: the
launch profile is already the per-project execution configuration surface and
is visible at launch confirmation; applying at the finish transition keeps
one owner for run state. **Alternatives**: per-plan policy (more knobs than
the workflow needs today; can layer later), frontend-applied policy (races
restarts; backend owns run state).

**Decision**: Policy consent model — configuring a policy is the explicit
user trigger required by the no-silent-side-effects rule; every automated
action notifies and logs; `auto_commit_pr` additionally requires a one-time
per-project acknowledgment because it touches the remote; merge-to-default
is excluded from automation entirely. — **Rationale**: preserves the security
posture (local-first, explicit consent for remote effects) while delivering
the owner's configurable automation. **Alternatives**: per-run confirmation
prompts (defeats the point of a policy), global default (too coarse —
projects differ).

**Decision**: Merge review session is a frontend-orchestrated state machine
over existing backend commands (queue listing, merge, verify, prune) with
per-step confirmations, not a new backend session entity. — **Rationale**:
all mutations remain the existing confirm-gated commands; the session is
ordering + presentation; a crash mid-session loses only UI position, never
git state. **Alternatives**: backend session rows (adds state to reconcile
with git reality for no safety gain).

**Decision**: Mission control consumes the existing planning event stream and
the PanelStatus pipeline (provider lifted shell-wide in PR #26) rather than a
new polling path. — **Rationale**: counts and cards stay consistent with the
command strip and sidebar dots by construction (single source of truth
requirement in `planning-flow-board`).

## Risks / Trade-offs

- **Estimate noise on sparse ticks** → median inter-tick interval, minimum
  two ticks before showing a number, "estimate" label always.
- **Policy misfire (unwanted commits)** → default `hold`; worktree-only
  scope; non-git/primary-checkout runs hard-fallback to `hold`; every action
  notified + logged; failures surface on the card without retries.
- **Session ordering vs. reality drift** (a merge changes ahead/behind of
  later runs) → refresh per-run context when presented, not at session start.
- **Surface weight** (another board) → mission control is lazy-loaded and
  reuses run-board data; the flow board's Runs stage links into it.
- **Round deploy chains two batch actions** → one confirmation enumerates
  both halves; per-item failure isolation reuses existing batch semantics.

## Migration Plan

Additive only. New launch-profile field defaults to `hold` (absent = hold, no
migration needed for existing rows). No status vocabulary changes. Rollback =
feature surfaces removed; stored policy field is ignored harmlessly.

## Open Questions

- Should round history live under the Ideas tab or as a flow-board drill?
  (Default: Ideas tab section; revisit after the live audit.)
- Does `queue_merge_review` need a distinct queue badge, or is the existing
  merge-ready state enough? (Default: reuse merge-ready state + group
  selection.)
