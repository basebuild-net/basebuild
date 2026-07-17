---
name: basebuild-execution-advisor
description: Request and interpret Basebuild's local, privacy-bounded planner/coder model recommendations. Use when choosing a model for an idea or plan, comparing connected routes, or deciding whether current capacity can support the estimated work.
---

# Basebuild Execution Advisor

Use `get_execution_advice` only after an idea or plan has a persisted bounded assessment. Pass exactly one `ideaId` or `planId`.

## Interpretation

- Treat the recommendation as advice, never as permission to launch.
- Prefer the role that matches the next action: `planner` for design/spec work; `coder` for implementation.
- Read `excluded` before proposing a route the user cannot execute.
- Read every factor and `sourceFreshness`; a high aggregate score does not override a hard compatibility exclusion.
- `high` confidence means the route has fresh public profile and local availability evidence. `medium` or `low` means material evidence is missing or stale.
- A user override is intentional and wins while compatible. Explain any hard gate that prevents it.
- Missing capacity means unknown—not unlimited and not exhausted. Ask the user when the decision depends on uncertain quota or timing.
- Stale capacity can inform a comparison but cannot justify claiming that a provider has enough quota.

## Privacy boundary

The ranking runs locally. Tool output is allowlisted to persisted assessment metadata, provider/model identifiers, coarse capacity evidence, public profile references, factor explanations, and freshness/confidence. It excludes credentials, account identifiers, project text, source, messages, questionnaire answers, raw usage, diffs, logs, and absolute paths.

When the active chat uses an external provider, returning tool output crosses that provider boundary. Respect the `allowExternalContext` decision. If denied, use the desktop's local advisor UI or ask the user to choose; never reconstruct private context for the provider.

## Decision procedure

1. Request advice for the persisted idea or plan.
2. Confirm the recommended route is connected and not excluded.
3. Compare planner and coder roles separately.
4. Surface the leading factors, exclusions, freshness, and confidence.
5. If confidence is low or all routes are excluded, ask a focused question instead of guessing.
6. Let the user confirm or override the launch profile. Do not start execution from this skill.
