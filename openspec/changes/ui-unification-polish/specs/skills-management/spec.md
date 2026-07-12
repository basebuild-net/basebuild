## ADDED Requirements

### Requirement: Plan launch profile skill picker
The plan promotion form's skill field SHALL be a picker fed by `list_resolved_skills` (plus a "No skill" option) instead of a free-text input. Selecting a skill SHALL write the skill's name as the profile `skillId` — the identical persisted shape the text input produced. When the skill list is empty or the backend call fails, the form SHALL fall back to the free-text input so the field is never lost.

#### Scenario: Picking a skill
- **WHEN** the user opens the skill picker and selects a resolved skill
- **THEN** the launch profile's `skillId` is set to that skill's name

#### Scenario: Clearing the skill
- **WHEN** the user selects "No skill"
- **THEN** `skillId` is persisted as an empty value, matching the previous default

#### Scenario: Fallback on empty registry
- **WHEN** `list_resolved_skills` returns an empty list or errors
- **THEN** the free-text skill input renders so existing workflows keep working

### Requirement: Skill rows are grounded in the registry
All skills surfaced in the Skills tab and the plan skill picker SHALL come from the `list_resolved_skills` Tauri command — no hardcoded skill lists in the frontend.

#### Scenario: Registry is the single source
- **WHEN** a skill is added to the user skills directory and the registry re-resolves
- **THEN** it appears in both the Skills tab and the plan skill picker without frontend changes
