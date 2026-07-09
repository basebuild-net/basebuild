# chat-idea-generation Specification (delta)

## MODIFIED Requirements

### Requirement: Grounded Generation Inputs
Idea and category generation SHALL always assemble the schematic focus
directive plus the decision digest (plans finished since the schematic's
last update, recently picked ideas, recently rejected ideas) into the
generation prompt. When the digest is empty the prompt SHALL state that
explicitly rather than omitting the section. Generation results SHALL
carry grounding metadata: schematic sections used, finished-plan count,
picked count, rejected count.

#### Scenario: Digest included when plans shipped
- **WHEN** ideas are generated and two plans finished since the schematic was last updated
- **THEN** the generation prompt contains those plan titles/references and the result metadata reports a finished-plan count of 2

#### Scenario: Empty digest is explicit
- **WHEN** ideas are generated with no finished plans or idea decisions since the last schematic update
- **THEN** the prompt states that no decisions have landed since the schematic update and generation proceeds on the schematic alone

## ADDED Requirements

### Requirement: Grounding Provenance Display
Each generated idea batch SHALL display what grounded it: the schematic
sections consulted and how many finished plans and idea decisions fed the
digest, with plan references available in a tooltip. Each idea SHALL show
its schematic anchor, or an explicit outside-current-focus flag when it
has none, and the batch summary SHALL show anchored versus outside-focus
counts.

#### Scenario: Batch header names its grounding
- **WHEN** an idea batch is generated
- **THEN** the batch header shows the schematic sections used and the finished-plan count, with plan reference ids listed in a tooltip

#### Scenario: Unanchored idea is flagged
- **WHEN** a generated idea carries no schematic anchor
- **THEN** the idea card shows an outside-current-focus flag rather than silently omitting the anchor

### Requirement: Generate From Finished Plans
The planning surface SHALL offer a generate-from-finished-plans action
that produces follow-on ideas derived from recently finished plans,
weighting the decision digest in the prompt. The action SHALL be disabled
with an explanatory tooltip when no plans have finished since the last
schematic update.

#### Scenario: Follow-on generation from shipped work
- **WHEN** the user runs generate-from-finished-plans with finished plans available
- **THEN** generation runs with the digest-weighted prompt and the resulting batch is labeled as derived from finished plans

#### Scenario: Disabled without finished plans
- **WHEN** no plans have finished since the last schematic update
- **THEN** the action is disabled with a tooltip explaining why
