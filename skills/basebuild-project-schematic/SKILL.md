---
name: basebuild-project-schematic
description: Create, update, and re-align a .basebuild/project-schematic.md - the source of truth for what a project is, what it should become (Vision), its core rules, and current priorities. Guided section-by-section questionnaire with repository-fact prefill, per-section updates, and a re-alignment mode that diffs the schematic against repo reality and .basebuild planning data. Use when the user says "project schematic", "update the schematic", "re-align", "what is this project", or after major work finishes. Pairs with basebuild-planning, which consumes Vision and priorities.
---

# Project Schematic

A Project Schematic is a single markdown file at `.basebuild/project-schematic.md`
describing what a project is, what it should become, how to work on it, and
what matters right now. Agents use it as the steering document; the
`basebuild-planning` skill derives idea categories and grounded ideas from its
Blueprint, Vision, End goals, and Current priorities.

You are an interviewer and an auditor — never an author of fiction:

- **Never fabricate facts.** Derive from the repository or ask.
- **Prefill before asking.** When a fact is observable (stack from manifests,
  architecture from the tree), present it for confirmation instead of asking
  the user to recite it.
- **The user's language wins.** Shape answers; do not editorialize.
- **Explicit approval before every write.** Show the full proposed document or
  a per-section diff first. This file steers agents — silent edits are
  sabotage.
- **Concise.** Readable in under three minutes.

## Modes

| User intent | Mode |
|---|---|
| No schematic exists / "create a schematic" | **Create** |
| "update the schematic", "priorities changed" | **Update** |
| "re-align", "is the schematic still accurate", after big plans finish | **Re-align** |

## Document template

Emit exactly this structure, in this order:

```markdown
# Project Schematic: <Project Name>

## Purpose
<one paragraph: what it does, for whom, why it exists>

## Vision
<what the project should become — the target state. The gap between Vision
and today is deliberate fuel for idea generation>

## Blueprint
<archetype: SaaS, game, CLI, library, app, site; team size: solo or N people; stage: prototype, MVP, production>

## End goals
<time-boxed goals — "End goal of 2026: ..." and "End goal of July 2026: ...">

## Target users
<one paragraph + primary user stories>

## Tech stack
<runtime, framework, languages, key libraries — only what shapes the work>

## Architecture notes
<boundaries, invariants, data model, folders an agent must know>

## Design constraints
<hard visual/system rules — part of the project's core rules>

## Development conventions
<naming, error handling, testing, docs — the rest of the core rules>

## Current priorities
<top 3–5 open concerns, ranked>

## Open questions
<what is unclear; decisions needing a human>
```

Core rules = Design constraints + Development conventions: the invariants an
agent must never break. Make them actionable ("0px border radius everywhere"),
not aspirational ("clean code").

## Create mode

Start with the **Blueprint** questions (archetype, team size, stage) — they
scope every later answer and feed planning. Then work the remaining sections in
template order. For each section:

1. **Prefill**: read what the repository already says — manifests
   (`package.json`, `Cargo.toml`, …), README, convention files (`AGENTS.md`
   or equivalents), directory structure, recent git history. Present derived
   facts for confirmation.
2. **Ask** only what is not observable. Per section, the questions that matter:
   - *Purpose*: one sentence of what it does; the problem existing tools miss.
   - *Vision*: what should this be in 6–18 months? What would make it done or
     great? What is deliberately out of ambition?
   - *Blueprint*: which archetype (SaaS, game, CLI, library, app, site)? Ask
     archetype-appropriate, real-world-blueprint questions (a SaaS is asked
     about market/tenancy/pricing shape; a solo-dev game is scoped with solo
     assumptions). Team size (solo or N people)? Stage (prototype, MVP,
     production)?
   - *End goals*: a year-end goal ("End goal of 2026: …") and a month-end goal
     ("End goal of <month> 2026: …") in plain words. These keep work on track.
   - *Target users*: who, top three jobs, skill level, environment. Concrete
     stories beat personas.
   - *Tech stack*: confirm the derived stack; max ~5 critical dependencies;
     external CLIs/services (Git, Docker, OMP…).
   - *Architecture notes*: major parts, UI/backend boundary, what persists
     where, invariants that must never break, first folders to read.
   - *Design constraints*: design system source of truth, hard visual rules,
     reuse policy.
   - *Development conventions*: error handling, when tests are required, docs
     that must move with code, lint/format, commit style.
   - *Current priorities*: most important next, in progress, blocked, risky,
     avoid-for-now. Rank, cap at 5.
   - *Open questions*: what needs a human decision; where agents must not
     assume.
3. Finish a section before the next. Skip only on explicit request.

Assemble the document, show it in full, write only after approval.

## Update mode

1. Read the current schematic.
2. For each section (or only the ones the user names): show current text, ask
   "still accurate — what changed?".
3. Rewrite only sections whose answers changed; preserve everything else
   **verbatim** — byte-for-byte.
4. Legacy schematic missing `## Vision`, `## Blueprint`, or `## End goals`:
   offer to add them (one question each), never force them.
5. Show a per-section diff; write after approval.

## Re-align mode

Audit the schematic against observable reality. No questionnaire — evidence.
This is the re-alignment mode.

1. **Collect evidence**:
   - Repository: structure, manifests, convention files, recent git history.
   - Planning data (when `.basebuild/` planning files exist): categories,
     picked-idea themes, plans and statuses — especially plans `finished`
     since the schematic was last touched, and `running` work.
2. **Diff per section**. Drift examples: a Current priority shipped
   (finished plan slug is the evidence); a subsystem exists that Architecture
   notes never mention; the stack gained/lost a critical dependency; Vision
   already achieved or contradicted by direction.
3. **Report**: per drifted section — current text, the evidence (file paths,
   plan slugs), proposed replacement text. Sections without drift are listed
   as verified.
4. **No drift at all** → say so explicitly and change nothing.
5. Apply only the edits the user approves, preserving untouched sections
   verbatim.
6. When finished plans made priorities stale, propose refreshed Current
   priorities citing those plan slugs — and, when the gap between Vision and
   reality shifted, offer a Vision touch-up.

After a re-alignment that changed priorities or Vision, suggest (once) running
`basebuild-planning` to regenerate categories from the fresh fundamentals.

## Enhance a section

The app's per-section **Enhance** action calls this skill to turn a user's
plain words into an agent-optimized description — precise, structured, and
directly consumable by planning — without changing their meaning or losing
their voice. Rewrite only the section given; keep it concise; preserve any
concrete facts. Present the result as a before/after diff and apply only on
approval. Never silently replace the user's text.

## Special case: Basebuild itself

When the project is Basebuild: reference README, AGENTS.md, DESIGN.md, and the
active OpenSpec roadmap; keep the wrapper nature explicit (control plane for
OMP/Git/editors, not a replacement); include the plan lifecycle and status
semantics; preserve the rule that agents modify `AGENTS.md` and this schematic
only with explicit user approval; note that skills live in
`skills/<name>/SKILL.md`.
