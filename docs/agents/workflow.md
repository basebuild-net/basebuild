# Contributor Workflow

Everything an agent needs to run a change end to end: branching, committing,
keeping docs and the roadmap honest, and the pre-yield checklist. `AGENTS.md`
holds the terse invariants; this file holds the rationale and the how-to.

## Feature branches (Invariant 11)

Never build on `main`. Before starting any non-trivial change, create a branch
named after the work (e.g. `feat/startup-update-splash`, `fix/pty-plumbing`,
`docs/roadmap-truth`). If the current branch is already non-`main`, stay on it.

- Do not commit to `main`. Do not push commits to `main`.
- Only merge a feature branch into `main` after the work is verified (see
  [Before you yield](#before-you-yield)).
- Prefer a descriptive prefix: `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`.

## Commit milestones (Invariant 10)

Keep large changes in coherent, verified milestones.

- If the user has explicitly asked for commits, commit each completed milestone
  separately with a clear [Conventional Commits](https://www.conventionalcommits.org/)
  message (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`…). Subject in the
  imperative and short; add a body only when the *why* is not obvious.
- Otherwise, do **not** create commits silently. Report suggested commit points
  and let the user drive.
- A milestone is committable only when its verification passes — no
  "checkpoint" commits of broken state.

## Documentation maintenance

When you change behavior, update its documentation in the **same change**:

| Change | Document |
|---|---|
| Visual design language (colors, spacing, states, layout intent) | `DESIGN.md` (visual/non-technical only) |
| CSS classes, selectors, or layout mechanics | `docs/agents/design-system.md` (NOT `DESIGN.md`) |
| Plan model, Project Schematic, or status semantics | `AGENTS.md` (Invariant 9) and `.basebuild/project-schematic.md` |
| Build / dev / secrets | `docs/DEVELOPMENT.md` or `docs/SECRETS.md` |
| High-level project pitch or contribution | `README.md` |
| OpenSpec plan or progress | Local, gitignored `openspec/` workspace only — never stage, commit, push, or attach it to a PR (see [`openspec.md`](./openspec.md)) |
| Skills | `skills/<name>/SKILL.md` |
| Data collection / privacy behaviour | `docs/agents/agent-runtime.md` and `docs/SECRETS.md` |
| Agent/chat/terminal/adapter behavior | `docs/agents/agent-runtime.md` |
| Tab/panel/workspace routing | `docs/agents/desktop-shell.md` |
| Testing requirements | `docs/agents/testing.md` |

## Before you yield

Do not claim a change complete until every line holds:

- [ ] `npx tsc --noEmit` passes; `npm run build` passes; `cargo check` /
      `cargo test` pass when Rust changed — actually run, never assumed.
- [ ] `BASEBUILD_E2E=1 npm run test:e2e` passes when a browser workflow changed.
- [ ] New interactive elements have `title=` tooltips; 0px radius; styles only
      in `globals.css`.
- [ ] UI changes have a screenshot from the running app (see
      [`testing.md`](./testing.md#visual-verification)).
- [ ] Behavior docs updated per the [maintenance table](#documentation-maintenance).
- [ ] Local `openspec/` proposals, specs, tasks, archives, and roadmap remain
      ignored and absent from the Git index.
- [ ] Work is on a feature branch; commit points reported, no silent commits.
