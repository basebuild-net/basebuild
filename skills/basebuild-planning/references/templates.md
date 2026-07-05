# Planning File Templates

Copy-paste starting points. Field semantics and invariants live in
`schema.md` — read it first; it wins on any conflict.

## `categories.md`

```markdown
# Categories

## <slug>
name: <Display Name>
description: <One line: what work belongs in this category.>
```

## Idea — `ideas/<slug>.md`

```markdown
---
title: <Short imperative title>
category: <category-slug>
status: concept
created: <YYYY-MM-DD>
anchor: <Vision / End goal / Current priority this serves, or omit if outside focus>
---
<1–3 sentences: what and why, specific to THIS project.>

## Grounding
- <real file / function / observation that justifies this idea>
- <second citation when available>
```

## Plan record — `plans/<slug>/plan.md` (native engine)

```markdown
---
title: <Plan title>
status: draft
created: <YYYY-MM-DD>
ideas:
  - <idea-slug>
engine: native
---
## Goal
<One paragraph: the outcome, stated so completion is checkable.>

## Context
<What the executor must know: current behavior, relevant files with paths,
prior decisions. Written for a reader with ZERO conversation context.>

## Constraints
<Project conventions restated inline (not referenced from memory): style
rules, architectural invariants, naming, error-handling expectations.>

## Non-goals
<What this plan explicitly does not do. Kills scope drift.>

## Approach
<How, at the level of files and components. Decisions with one-line rationale.>

## Verification
<Concrete commands and expected results proving the goal is met.>
```

## Plan record — `plans/<slug>/plan.md` (external engine)

```markdown
---
title: <Plan title>
status: planned
created: <YYYY-MM-DD>
ideas:
  - <idea-slug>
engine: <engine-skill-name>
external: <path, e.g. openspec/changes/<slug>/>
---
## Goal
<One paragraph.>

Full plan content lives in `<external path>` — do not duplicate it here.
```

## Native tasks — `plans/<slug>/tasks.md`

```markdown
# Tasks: <Plan Title>

## 1. <Phase name>

- [ ] 1.1 <Task naming exact files. Acceptance: <observable criterion>.>
- [ ] 1.2 <Task.>
- [ ] 1.3 Verify: run `<command>`; expect <result>.

## 2. <Phase name>

- [ ] 2.1 <Task.>
- [ ] 2.2 Verify: run `<command>`; expect <result>.
```

## Native design — `plans/<slug>/design.md` (optional)

Create only when the plan is cross-cutting, introduces a dependency, touches
data models/security/performance, or contains decisions an executor could get
wrong without rationale.

```markdown
# Design: <Plan Title>

## Decisions
- **Decision**: <choice> — **Rationale**: <why>. **Alternatives**: <rejected, why>.

## Risks
- <risk> → Mitigation: <how>.

## Guardrails
- Do not touch <files/areas> — <reason>.
```

## `config.toml` — created only when missing

```toml
version = 1

[planning]
engine = "native"
```
