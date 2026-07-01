# OpenSpec Workflow

Basebuild uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) for planned
changes. Changes live in `openspec/changes/<change-name>/`.

## Starting a change

Use the `/propose` skill:

```
/propose
```

This creates:
- `proposal.md` — why and what
- `specs/<capability>/spec.md` — requirements and scenarios
- `design.md` — technical approach (if needed)
- `tasks.md` — implementation checklist

## Applying a change

Use the `/apply` skill:

```
/apply
```

This works through `tasks.md` one checkbox at a time. Mark each `[x]`
immediately after completing it. Update specs and design if you discover
something that needs changing.

## Archiving a change

Use the `/archive` skill when all tasks are complete. This merges delta specs
into `openspec/specs/`.

## Rules

- Every requirement MUST have at least one `#### Scenario:`.
- Scenarios use 4 hashtags exactly. Using 3 fails silently.
- Specs define WHAT the system should do, not HOW.
- Tasks should be small enough to complete in one session.
- Check `openspec/specs/` for existing capabilities before creating new ones.
- The `openspec/changes/` directory is the source of truth for in-progress work.
- `openspec/config.yaml` has project context that is injected into all artifacts.
