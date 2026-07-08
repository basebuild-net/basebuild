## MODIFIED Requirements

### Requirement: Editable planning system prompts
The system SHALL expose the prompts used for chat-led planning as editable settings. There SHALL be distinct prompts for chat harness (`chat_system`), idea generation (`idea_generation`), category generation (`category_generation`), clarification/question generation (`planning_questions`), and OpenSpec handoff (`openspec_handoff`). Prompts for idea/category/question generation SHALL instruct agents to ask concise, clickable questions and generate grounded ideas; OpenSpec handoff prompts SHALL instruct agents to create/modify OpenSpec artifacts and avoid inventing a parallel native planning format. Defaults SHALL be derived at read time from bundled skill content where possible so skill files remain the source of truth. A user override SHALL be persisted locally when saved. No prompt text SHALL leave the machine except as part of the user's chosen local agent request.

#### Scenario: View prompts with defaults
- **WHEN** the user opens Settings → Planning
- **THEN** each prompt is shown in an editable field populated with the current effective value, prompts with overrides are marked as modified, and derived prompts show their source skill

#### Scenario: Save an override
- **WHEN** the user edits a prompt and clicks Save
- **THEN** the override is persisted locally and subsequent generation of that kind uses the saved text

#### Scenario: Reset to default
- **WHEN** the user clicks `Reset to default` for a prompt
- **THEN** the override is removed, the field repopulates with the skill-derived or compiled default, and subsequent generation uses it

#### Scenario: Generation reflects overrides
- **WHEN** an override exists for a generation kind and that generation runs
- **THEN** the request is assembled with the override text as the system prompt for that kind, without requiring an app restart

#### Scenario: Skill change propagates to defaults
- **WHEN** the bundled skill content changes and no override exists for a kind
- **THEN** Settings → Planning and the next generation both reflect the updated skill-derived default without migration

#### Scenario: OpenSpec handoff stays focused
- **WHEN** the `openspec_handoff` prompt is used
- **THEN** it tells the agent to operate on `openspec/changes/<slug>/proposal.md`, `specs/**/spec.md`, `design.md`, and `tasks.md`, and explicitly says not to create a second implementation-plan artifact outside OpenSpec
