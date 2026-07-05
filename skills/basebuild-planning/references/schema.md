# `.basebuild` Planning File Schema (normative)

Schema version 1. This file is the contract for planning data on disk. If any
other document (including SKILL.md) disagrees with this file, this file wins.
Changing this schema is a spec change, not a drive-by edit.

## Layout

```
.basebuild/
├── config.toml            # shared with the Basebuild app — planning owns ONLY the [planning] table
├── project-schematic.md   # maintained by the basebuild-project-schematic skill
├── categories.md          # category registry
├── ideas/
│   └── <slug>.md          # one file per idea
└── plans/
    ├── <slug>/            # one folder per plan
    │   ├── plan.md        # lifecycle record + plan content (always present)
    │   ├── tasks.md       # native engine only
    │   └── design.md      # native engine only, optional
    └── archive/
        └── <slug>/        # archived plan folders, moved intact
```

App-owned entries — `prompts/`, `workflows/`, `cache/`, `logs/`, `runs/`,
`state.db`, `.gitignore` — are NEVER created, modified, or deleted by planning
workflows. `categories.md`, `ideas/`, and `plans/` are version-controlled data;
do not add them to any ignore file.

## Slugs

- kebab-case, ASCII `[a-z0-9-]`, 2–4 words derived from the title
  (`"Add sitemap.xml for dynamic routes"` → `add-sitemap`).
- A plan slug doubles as the external change name when an external engine is
  used (e.g. `openspec/changes/<plan-slug>/`).
- On collision with an existing slug (any status, including archive), append a
  numeric suffix: `<slug>-2`, `<slug>-3`. Never overwrite.

## `categories.md`

One `##` section per category. Slug is the heading; `name` and `description`
are required fields. Anything after the fields is free-form user notes and MUST
be preserved on regeneration.

```markdown
# Categories

## optimization
name: Optimization
description: Performance, bundle size, query speed, memory.

## bug-fixes
name: Bug Fixes
description: Known issues, error handling, edge cases, flaky tests.
```

Merge rules: regeneration may append new sections and may propose edits, but
existing sections are removed or rewritten only with explicit user
confirmation.

## Idea file — `ideas/<slug>.md`

YAML frontmatter followed by a markdown body.

| Key        | Type            | Required | Notes                                        |
|------------|-----------------|----------|----------------------------------------------|
| `title`    | string          | yes      | Short, imperative                            |
| `category` | string (slug)   | yes      | Must exist in `categories.md`                |
| `status`   | enum            | yes      | `concept` \| `picked` \| `archived`          |
| `created`  | date `YYYY-MM-DD` | yes    |                                              |
| `anchor`   | string          | no       | Schematic element served (Vision / End goal / priority) |
| `plan`     | string (path)   | no       | `plans/<plan-slug>/` — set when promoted     |

Body: 1–3 sentence description, then a `## Grounding` section citing the real
files, functions, or observations that justify the idea. Ideas with no
grounding are invalid.

```markdown
---
title: Add sitemap.xml for dynamic routes
category: seo
status: picked
created: 2026-07-05
plan: plans/add-sitemap/
---
Dynamic routes are invisible to crawlers because no sitemap is generated.

## Grounding
- `src/routes/` registers 14 dynamic routes; no `sitemap` reference anywhere.
- `public/` has `robots.txt` but no `sitemap.xml`.
```

## Plan record — `plans/<slug>/plan.md`

YAML frontmatter followed by a markdown body. The plan record owns lifecycle
regardless of which engine produced the plan content.

| Key        | Type          | Required | Notes                                                     |
|------------|---------------|----------|-----------------------------------------------------------|
| `title`    | string        | yes      |                                                           |
| `status`   | enum          | yes      | see Statuses                                              |
| `created`  | date          | yes      |                                                           |
| `ideas`    | list of slugs | yes      | source ideas (may be several — bundled promotion)         |
| `engine`   | string        | yes      | `native` or the engine skill name (e.g. `openspec`)       |
| `external` | string (path) | no       | external engines only — root of the engine's artifacts    |

Native-engine body sections, in order: `## Goal`, `## Context`,
`## Constraints`, `## Non-goals`, `## Approach`, `## Verification`.
External-engine body: `## Goal` plus a line pointing at `external` for the
full content. Never duplicate the external engine's task list.

## Native tasks — `plans/<slug>/tasks.md`

```markdown
# Tasks: <Plan Title>

## 1. <Phase>
- [ ] 1.1 <small, ordered task naming exact files, with acceptance criteria>
- [ ] 1.2 Verify: <concrete command(s) and expected result>
```

- Checkbox lines are exactly `- [ ] N.N ` / `- [x] N.N ` — progress is
  derived by counting checkboxes; no other bookkeeping exists.
- Every phase ends with a verification task carrying runnable commands.

## Statuses

Idea: `concept → picked → archived` (snake_case, no other values).

Plan: `draft → planned → ready → running → finished`; `cancelled` is reachable
from any non-terminal status. All snake_case.

| Status      | Meaning                                                        |
|-------------|----------------------------------------------------------------|
| `draft`     | Record exists; plan content not yet complete                   |
| `planned`   | Artifacts complete and thought out — engine-neutral            |
| `ready`     | User approved for execution                                    |
| `running`   | Execution in progress                                          |
| `finished`  | Work complete and verified                                     |
| `cancelled` | Abandoned; artifacts kept                                      |

App compatibility note: the Basebuild desktop app's database currently names
the `planned` stage `openspec`. The file schema deliberately uses `planned`
(engine-neutral); the app-side rename is tracked separately. When mapping:
file `planned` ⇔ app `openspec`. Every other status name matches 1:1.

## `config.toml` — `[planning]` table

Planning configuration lives in the same `.basebuild/config.toml` the Basebuild
app creates. Planning workflows own ONLY the `[planning]` table.

```toml
[planning]
engine = "native"        # or a planning skill name, e.g. "openspec"
```

Merge rules:
- File exists → add or update the `[planning]` table only; every other line is
  preserved byte-for-byte.
- File missing → create it containing exactly `version = 1` and the
  `[planning]` table.

## Archive

- Plans: move the whole folder to `plans/archive/<slug>/`, contents unmodified.
  Update any idea whose `plan:` points at the moved folder to the archive path.
  Only `finished` or `cancelled` plans may be archived.
- Ideas: archive in place by setting `status: archived`; the file does not move.
