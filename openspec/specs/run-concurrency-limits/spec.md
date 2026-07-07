# run-concurrency-limits Specification

<!-- Merges: ADDED from 'parallel-plan-workspaces' (archived 2026-07-06). -->

## Requirements

### Requirement: Per-provider concurrency limits
The system SHALL store a maximum concurrency per provider as a global default with an optional per-project override. The run scheduler SHALL NOT execute more simultaneous provider requests (plan runs plus any subagents) for a given provider than that provider's effective limit; runs beyond the limit SHALL queue rather than fail. The default per-provider limit SHALL be conservative (`1`), reflecting that most providers rate-limit or meter concurrent requests and only unmetered / high-bandwidth endpoints tolerate many.

#### Scenario: Default one run per provider
- **WHEN** a project has no configured concurrency and two plans using the same provider are assigned to two chats
- **THEN** one run executes and the second queues until the first finishes (default provider limit `1`)

#### Scenario: Raise the limit for a high-bandwidth provider
- **WHEN** the user sets the provider's max concurrency to `4` in settings and assigns four plans on that provider
- **THEN** all four runs execute concurrently, each in its own chat/worktree, and a fifth queues

#### Scenario: Per-project override
- **WHEN** the global limit for a provider is `2` and a project overrides it to `1`
- **THEN** runs in that project use the effective limit `1`, while other projects continue to use `2`

#### Scenario: Excess queues, never errors
- **WHEN** more runs are assigned than the effective limit allows
- **THEN** the excess runs enter a queued state with a visible reason ("waiting for a <provider> slot"), and start automatically as slots free — no run is dropped or errored for hitting the cap

#### Scenario: Mixed providers run independently
- **WHEN** runs on provider A (limit 2) and provider B (limit 1) are assigned together
- **THEN** up to 2 A-runs and 1 B-run execute concurrently, each provider bounded by its own limit

### Requirement: Subagents off by default, configurable count
The system SHALL default to no subagents — one model per chat, no delegated sub-sessions. Users MAY enable subagents and set a maximum subagent count in global settings with an optional per-project override. Subagent execution mechanics are owned by the `harness-subagents` capability; this capability governs whether subagents are permitted and how many, and counts active subagents against their provider's concurrency limit.

#### Scenario: No subagents by default
- **WHEN** a chat runs a plan and the user has not enabled subagents
- **THEN** the run uses a single model with no delegated sub-sessions, and any attempt by the agent loop to delegate is declined with a visible "subagents disabled" notice

#### Scenario: Enable subagents with a count
- **WHEN** the user enables subagents and sets a maximum of `3`
- **THEN** a run may delegate up to 3 concurrent subagents, subject to the provider concurrency limit

#### Scenario: Subagents count against the provider limit
- **WHEN** a provider's concurrency limit is `2`, one plan run is active on that provider, and it spawns subagents on the same provider
- **THEN** the active run plus its subagents never exceed 2 concurrent requests to that provider; additional subagents queue

#### Scenario: Per-project subagent override
- **WHEN** the global subagent maximum is `2` and a project overrides it to `0`
- **THEN** runs in that project delegate no subagents regardless of the global setting

### Requirement: Concurrency settings surface
The concurrency and subagent limits SHALL be configurable in global Settings and per-project Settings, showing the effective value (project override else global) per provider. The settings UI SHALL use `src/styles/globals.css`, 0px radius, and `title` tooltips on every control.

#### Scenario: Edit global provider limits
- **WHEN** the user opens Settings and edits a provider's max concurrency
- **THEN** the value is persisted to local settings and applied to subsequent scheduling decisions without an app restart

#### Scenario: Project override display
- **WHEN** a project overrides a provider's limit
- **THEN** the project settings show the override value and the global default it replaces, each with a `title` tooltip explaining precedence

#### Scenario: Effective value shown at the point of use
- **WHEN** a run is queued because a provider limit is reached
- **THEN** the queued notice names the provider and the effective limit responsible, so the user can find and adjust the right setting
