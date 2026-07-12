## ADDED Requirements

### Requirement: One-click zero-input generation round
The planning surface and the planning command strip SHALL offer a one-click
"Generate ideas" round that requires no free-text input. The round SHALL
assemble its grounding per the `grounded-generation` requirements — schematic
focus directive, decision digest (recent picked/rejected ideas and finished
plans), `.basebuild/preferences.md` when present, and existing-catalog
awareness — and SHALL run as a visible agentic turn per `chat-idea-generation`
(context reads and captures stream into the transcript). Every idea captured
by a round SHALL carry that round's generation batch id. The schematic soft
gate (warn on `partial`/`missing` health, allow proceeding) SHALL apply to
rounds exactly as to other generation.

#### Scenario: Round runs without typing
- **WHEN** the user clicks "Generate ideas" on the planning surface with a
  complete schematic and no other input
- **THEN** a generation turn runs with the schematic focus directive, decision
  digest, and preferences in its instructions, captured ideas appear
  incrementally, and every captured idea carries the round's batch id

#### Scenario: Soft gate applies to rounds
- **WHEN** the user starts a round while schematic health is `missing`
- **THEN** the warning names the gap and offers the wizard, and proceeding
  anyway runs the round with whatever grounding exists

#### Scenario: Round ideas are batch-tagged
- **WHEN** a round captures four ideas and the app restarts
- **THEN** all four ideas reload with the same round batch id and remain
  attributable to that round

### Requirement: Round review and bulk deploy
The system SHALL present a round review listing the round's captured ideas
with grounding summary, anchor (or the `outside current focus` flag), and
status. The review SHALL support multi-selection and a **Deploy selected**
action that runs the existing batch promotion path (idea → `picked`, one
plan created per idea) behind ONE confirmation enumerating the plans to be
created and stating the next step. Deploy SHALL respect the plan lifecycle:
created plans start in `draft` and reach chats through the existing
OpenSpec → `ready` → batch-launch path (`plan-chat-assignment`) — deploy
SHALL NOT bypass artifact generation or dispatch runs directly. After a
successful deploy the Plans stage SHALL be focused with the created plans
visible. Declining SHALL create nothing. Per-idea failures SHALL be
reported without aborting the remainder. Reject and keep-as-concept actions
SHALL remain available per idea.

#### Scenario: Deploy three ideas into plans
- **WHEN** the user selects three round ideas, clicks Deploy selected, and
  confirms the enumerated summary
- **THEN** three plans are created through the promotion path, the ideas move
  to `picked`, and the Plans stage is focused showing the three new draft
  plans ready for the OpenSpec artifact step

#### Scenario: Decline creates nothing
- **WHEN** the user dismisses the deploy confirmation
- **THEN** no plan, chat, worktree, branch, run, or status change occurs

#### Scenario: Partial failure is isolated
- **WHEN** one selected idea fails to promote during deploy
- **THEN** the remaining ideas still deploy and the summary names the failed
  idea and reason

### Requirement: Round history
The planning surface SHALL list past rounds with timestamp and outcome counts
(captured / deployed / rejected / remaining concepts). Opening a past round
SHALL show its ideas filtered to that round's batch id with their current
statuses.

#### Scenario: Reopen a past round
- **WHEN** the user opens a round from history after two of its ideas were
  deployed and one rejected
- **THEN** the round view lists the round's ideas with current statuses
  (2 picked, 1 rejected, remainder concept) filtered to that round only
