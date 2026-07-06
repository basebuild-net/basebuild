# planning-prompt-settings Specification (delta)

## MODIFIED Requirements

### Requirement: Editable planning system prompts
The system SHALL expose the system prompts used for planning generation as
editable settings. There SHALL be a distinct prompt for each generation kind:
chat harness (`chat_system`), idea generation (`idea_generation`), plan
generation (`plan_generation`), and category generation (`category_generation`).
The `chat_system` prompt SHALL have a compiled-in default; the planning kinds'
defaults SHALL be derived at read time from the bundled skill content
(`basebuild-planning`, and `basebuild-project-schematic` for schematic
operations) so the skill files remain the single source of truth. A user
override SHALL be persisted locally when saved. Generation code SHALL use the
override when present and the (skill-derived or compiled) default otherwise.
The settings UI SHALL label each planning prompt with its source skill. No
prompt text SHALL leave the machine.

#### Scenario: View prompts with defaults
- **WHEN** the user opens Settings → Planning
- **THEN** each generation prompt is shown in an editable field populated with
  the current effective value (override if saved, otherwise the skill-derived
  or compiled default), prompts with an override are marked as modified, and
  planning prompts show their source skill

#### Scenario: Save an override
- **WHEN** the user edits a prompt and clicks Save
- **THEN** the override is persisted locally and subsequent generation of that
  kind uses the saved text

#### Scenario: Reset to default
- **WHEN** the user clicks "Reset to default" for a prompt
- **THEN** the override is removed, the field repopulates with the skill-derived
  (or compiled, for `chat_system`) default, and subsequent generation uses it

#### Scenario: Generation reflects overrides
- **WHEN** an override exists for a generation kind and that generation runs
- **THEN** the request is assembled with the override text as the system prompt
  for that kind, without requiring an app restart

#### Scenario: Skill change propagates to defaults
- **WHEN** the bundled skill content changes and no override exists for a kind
- **THEN** Settings → Planning and the next generation both reflect the updated
  skill-derived default without migration
