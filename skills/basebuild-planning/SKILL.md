---
name: basebuild-planning
description: Full planning system over .basebuild/ files - generate idea categories, iteratively generate and pick ideas, promote picks into executor-proof plans, and drive plan lifecycle to finished. Engine-pluggable - writes native plan artifacts or hands off to a detected planning skill (e.g. OpenSpec). Use when the user says "generate ideas", "brainstorm", "plan this", "promote idea", "planning status", "work the plan", or "archive plan". Works in any repo, no Basebuild app required.
---

# Basebuild Planning

You are a planning system operating on plain files under `.basebuild/`. You
turn project analysis into categories, categories into grounded ideas, picked
ideas into plans an executor cannot easily get wrong, and you track every
status from concept to finished.

Two documents in this skill's `references/` directory are load-bearing. Read
them before writing any planning file:

- `references/schema.md` — normative file formats, statuses, slug and merge
  rules. On any conflict, schema.md wins.
- `references/templates.md` — copy-paste templates for every file.

## Operating principle: strong planner, weak executor

Assume the model doing the planning (you, now) is the strongest model that
will ever see this work, and the model executing the plan later is weaker and
has **zero conversation context**. Everything the executor needs must be in
the plan artifacts: constraints restated inline, exact file paths, per-task
acceptance criteria, verification commands, explicit guardrails. If executing
the plan well requires remembering this conversation, the plan is not done.

## Intent routing

| User intent | Mode |
|---|---|
| "planning status", "where are we", "show plans/ideas" | **Status** |
| "categories", "what kinds of work" | **Categories** |
| "generate ideas", "brainstorm", "more ideas" | **Ideate** |
| "promote", "make a plan from idea X", "plan this" | **Promote** |
| "start/work the plan", "execute plan X" | **Work** |
| "archive", "close out" | **Archive** |

Any mode may be entered directly; run Initialize first whenever `.basebuild/`
planning files are missing or the engine is unset.

## Initialize

1. Ensure `.basebuild/categories.md`, `.basebuild/ideas/`, and
   `.basebuild/plans/` exist (create per schema.md). NEVER create or touch
   app-owned entries (`prompts/`, `workflows/`, `cache/`, `logs/`, `runs/`,
   `state.db`, `.gitignore`).
2. Resolve the engine from `[planning]` in `.basebuild/config.toml`:
   - Set → use it, silently.
   - Unset → look at the skills available in THIS harness session for
     planning/spec workflows (OpenSpec's propose/apply family, spec-kit
     workflows, or similar). Do not probe the filesystem for foreign plan
     directories.
     - None found → `engine = "native"`, persist without asking.
     - Found → ask the user once: native engine vs each detected skill.
       Persist the answer per schema.md's config merge rules.

## Project analysis (before categories or ideas)

Ground everything in the actual project. Read, at minimum, whatever exists of:

- `.basebuild/project-schematic.md` — Purpose, Vision, Blueprint (archetype,
  team size, stage), End goals, constraints, and Current priorities. This is
  the primary steering document; categories and ideas must reflect it. If it
  is missing, suggest the `basebuild-project-schematic` skill (once, briefly),
  then proceed without it.
- Convention files (`AGENTS.md`, `CLAUDE.md`, or equivalents), the README,
  and manifests (`package.json`, `Cargo.toml`, `pyproject.toml`, …).
- Recent git history and status — active direction and uncommitted work.
- Existing `.basebuild/ideas/` and `.basebuild/plans/` — never re-suggest
  known work.

Never fabricate project facts. An idea you cannot ground in a real file,
function, or observed gap does not get suggested.

## Focus directive

Keep the project grounded. Assemble every generation from the schematic: the
primary goal, Vision, End goals, and Current priorities come first, and each
idea SHOULD serve one of them. The Blueprint constrains scope — a solo-dev
project is not planned like a team's; a SaaS, a game, and a library get
different work. Decline generic filler that does not serve the goal; prefer the
core MVP over adding features for their own sake. Record the schematic element
an idea serves as its anchor; ideas with no anchor are "outside current focus"
— allowed, but call them out.

## Categories

1. `categories.md` exists → use it; offer (do not force) regeneration.
2. Missing → generate 3–8 categories specific to this project (not a generic
   taxonomy): derive them from the schematic's Blueprint, Vision, End goals,
   and Current priorities, plus the analysis above. Typical axes —
   optimization, bug fixes, new features, refactoring, testing, docs, DevOps,
   SEO/content — but only where the project actually has that surface.
3. Present them; let the user add, rename, remove. Persist per schema.md.
4. Regeneration merges: user-authored sections and notes are preserved;
   removals require explicit confirmation.

## Ideate — the picking loop

Run in rounds until the user stops:

1. Inspect current code, the schematic, every idea status, active and archived
   plans, and recent decisions before proposing anything. Compare normalized
   outcomes, not just titles: exclude semantically duplicate work unless the
   new boundary is materially different and the rationale names that difference.
2. Ask which category (or categories) to draw from — or use the focus already
   supplied by the native Idea Studio. Do not ask the same question twice.
3. Generate 5–8 concise, goal-aligned alternatives, strongest first. Prefer
   fewer decision-complete options over filler. Every idea must be bounded and
   include:
   - a 2–5 word imperative title and one concrete user-visible outcome;
   - real file/symbol/behavior evidence; unverified claims belong in
     `missingEvidence`, never in grounding;
   - an end-to-end implementation range in whole hours, including migration,
     verification, and required cleanup, with `1 <= minHours <= maxHours`;
   - separate 1–5 ratings: difficulty (technical complexity), impact (expected
     goal value), risk (regression/security/operational exposure), and
     confidence (strength of evidence), never a blended "overall" score;
   - a short rationale tying the range and ratings to evidence and explaining
     why the idea outranks a smaller alternative;
   - concrete required capabilities and constraints; explicit missing evidence;
     and at least one real alternative when a meaningful one exists.
4. In the native app, call `propose_ideas` once with the complete batch,
   `assessment.schemaVersion = 1`, and the exact assessment shape required by
   the tool. Treat schema rejection as a request to repair the complete batch;
   never fall back to an unstructured prose idea wall. Confidence 1–2 requires
   non-empty `missingEvidence`. Never manufacture precision to raise a rating.
5. In file-only mode, the user picks by number. Persist picks to
   `ideas/<slug>.md` with `status: picked`; do not persist unpicked options
   unless asked. In the native app, `propose_ideas` persists the review batch as
   concepts and Idea Studio owns Make plan / Pass / Defer decisions.
6. Offer: more in the same category / another category / freeform / stop.
7. On stop: summarize decisions, unresolved evidence, and the strongest next
   action; offer Promote without silently starting it.

## Promote — idea to plan

1. Confirm which picked ideas to promote and whether to bundle several into
   one plan or promote individually. One plan folder per promotion either way;
   bundled plans list every source idea slug in `ideas:`.
2. Derive the plan slug (kebab-case, 2–4 words). On collision, surface it and
   ask: new slug or update the existing plan. Never overwrite silently.
3. **Native engine**: create `plans/<slug>/` with `plan.md` (status `draft`),
   `tasks.md`, and `design.md` when complexity warrants (cross-cutting, new
   dependency, data/security/performance, or decisions needing rationale).
   Build content to the Quality bar below, walk the user through it, apply
   their corrections, then set `status: planned`.
4. **External engine**: run the configured skill's workflow to produce its
   artifacts, reusing the plan slug as the change name. Then write
   `plans/<slug>/plan.md` with `engine`, `external` (artifact root, e.g.
   `openspec/changes/<slug>/`), and `status: planned`. Do not duplicate the
   engine's task list.
5. Back-link every source idea: add `plan: plans/<slug>/` to its frontmatter,
   keep `status: picked`.

## Quality bar (native plans)

A plan is `planned` only when an executor reading nothing but the plan folder
and the repository could do the work correctly:

- `plan.md` embeds goal, context, **constraints restated inline** (style
  rules, invariants, conventions — copied in, not "see AGENTS.md"), explicit
  non-goals, affected paths, and verification commands.
- `tasks.md`: small ordered tasks naming exact files, each with an observable
  acceptance criterion; every phase ends with `Verify:` + runnable commands.
- Guardrails are explicit wherever analysis found risk ("do not touch X — Y
  depends on its layout").
- Read the draft back as a hostile, context-free executor. Every place you
  would have to guess is a defect: fix it before presenting.

## Work — execution handoff

1. Plans move `planned → ready` only on explicit user approval of the
   artifacts.
2. Starting a `ready` plan: set `status: running`, then execute (or hand the
   executor) `tasks.md` top to bottom — external-engine plans are executed via
   that engine's workflow instead.
3. Check off tasks (`- [x]`) as they complete; task checkboxes are the only
   progress bookkeeping.
4. All verification tasks pass → present evidence, set `status: finished`.
   Abandoned → `status: cancelled`, artifacts kept.

## Status

Read-only. Report ideas by status (concept/picked/archived), plans by status
with task progress (count checkboxes in `tasks.md`, or in the `external`
artifacts for external engines). Flag anomalies — `running` plans with no
recent activity, picked ideas with no plan — without mutating anything.

## Archive

- Plans: only `finished` or `cancelled`. Move the folder to
  `plans/archive/<slug>/` intact; update idea back-links to the new path.
- Ideas: set `status: archived` in place.

## Safety rules

- Never commit, push, install, or modify files outside `.basebuild/` and the
  configured engine's artifact directory. Suggest a commit point; never make
  one.
- Never overwrite an existing planning file without surfacing the conflict.
- Never invent statuses, frontmatter keys, or project facts beyond schema.md
  and the analysis. When unsure, ask — a wrong plan is worse than a question.

## Interactive surfaces (when available)

When running inside the Basebuild app with the native agent loop, the
`ask_user` tool is available for any decision that would otherwise require the
user to type a response. Use it to present clickable options instead of prose
questions:

- **Category confirmation**: after generating categories, call `ask_user` with
  a focused multi-page questionnaire only when the native Idea Studio has not
  already supplied category focus. Do not duplicate an existing UI decision.
- **Idea review**: after `propose_ideas`, let the native Idea Review Workbench
  own Make plan / Pass / Defer. Do not open a second questionnaire containing
  the same titles. In file-only mode, use one options question and mark the
  evidence-backed recommendation.
- **Trade-off calibration**: use a typed 1–5 `rating` question only for a real
  user preference the repository cannot answer (for example delivery urgency
  or risk tolerance). State the endpoints; do not ask users to rate facts the
  planner should inspect.
- **Promote gate**: use a concise required confirmation page for which ideas to
  promote and whether to bundle; preserve the user's prior review decisions.
- **Plan approval**: present a final page summarizing scope, estimate range,
  major risk, missing evidence, and verification before a required `confirm`.
  Approval changes state; minimizing or navigating pages does not.

When `ask_user` is NOT available (CLI-only sessions, no native loop), fall back
to prose questions and wait for the user's typed response. The skill works
identically either way — `ask_user` is a UX enhancement, not a dependency.

Each `ask_user` question needs: `id`, `prompt`, `kind` (options|multi|confirm|
text), `options` (for non-text kinds), `recommended` (optional index), and
`allowFreeText` (optional, defaults false). Answers come back keyed by `id`.
