# Tasks: Basebuild Planning Skill

## 1. Schema & Templates

- [ ] 1.1 Write `skills/basebuild-planning/references/schema.md` — normative `.basebuild/` layout, frontmatter keys, statuses (`planned` + app `openspec` mapping note), slug rules, archive semantics, `config.toml` `[planning]` merge rules
- [ ] 1.2 Write `skills/basebuild-planning/references/templates.md` — copy-paste templates: `categories.md`, idea file, `plan.md`, `tasks.md`, `design.md`

## 2. Planning Skill

- [ ] 2.1 Write `skills/basebuild-planning/SKILL.md` frontmatter (single-line `name`/`description` with trigger phrases) + intent routing (status / categories / ideate / promote / work / archive) + initialization behavior
- [ ] 2.2 Project-analysis and category workflow sections (grounding rules, merge-not-clobber registry)
- [ ] 2.3 Ideation loop (rounds, numbered picks, duplicate avoidance, stop → promotion offer)
- [ ] 2.4 Engine detection/selection/persistence + promotion flows (native, external hand-off, bundling, back-links)
- [ ] 2.5 Executor-proof quality bar, lifecycle transitions + status board, safety rules (no VCS side effects, overwrite guard)

## 3. Schematic Skill v2

- [ ] 3.1 Rework `skills/basebuild-project-schematic/SKILL.md`: template gains `Vision`; questionnaire prefills from repository facts; keep per-section update mode
- [ ] 3.2 Add re-alignment mode: drift report (repo + `.basebuild` planning data evidence), per-section proposed edits, explicit-approval-only writes
- [ ] 3.3 Add planning pairing: Vision/priorities feed category generation; finished plans trigger a priorities refresh offer

## 4. Repo Integration

- [ ] 4.1 Delete `skills/basebuild-idea-generation/`
- [ ] 4.2 Repo-wide grep for `basebuild-idea-generation`; confirm only the `official.idea-generation` config-pack id remains (separate subsystem — keep)

## 5. Verification

- [ ] 5.1 Temp-project dry-run (outside the repo): initialize planning files, generate categories + one ideation round, pick 2, promote 1 native plan; verify every file against `references/schema.md`, including `config.toml` `[planning]` merge against an app-style config
- [ ] 5.2 Temp-project dry-run of the external hand-off shape: promote 1 picked idea with `engine` set to an OpenSpec-style skill; verify `plan.md` records `engine` + `external` and no duplicate task list
- [ ] 5.3 Frontmatter compat: `name`/`description` single-line in both SKILL.md files (read_skill parser constraint); schematic v2 keeps its directory name
- [ ] 5.4 `npx tsc --noEmit`, `npm run build`, `cargo check`, `cargo test` — proves no app code was touched

## 6. Docs & Roadmap

- [ ] 6.1 Grep docs for references to removed/changed skills; update where they enumerate skills (AGENTS.md Documentation Maintenance row already covers `skills/<name>/SKILL.md`)
- [ ] 6.2 `node scripts/openspec-status.mjs --write` + ROADMAP narrative pass in the same commit (Invariant 12)
