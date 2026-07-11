## ADDED Requirements

### Requirement: Runtime defaults UI exists once
The runtime defaults fields (default chat adapter, default terminal) SHALL be implemented in a single shared component consumed by both the Settings modal Defaults tab and the First Run modal. Neither surface SHALL keep a private duplicate of these fields.

#### Scenario: Same fields in both surfaces
- **WHEN** the user opens First Run or Settings → Defaults
- **THEN** both render the same shared defaults fields with identical labels, tooltips, and behavior

#### Scenario: Saving from either surface
- **WHEN** the user changes the default terminal in either surface
- **THEN** `set_runtime_defaults` persists the same payload shape from both

### Requirement: Skills tab in settings
The Settings modal SHALL include a Skills tab listing all resolved skills from `list_resolved_skills`. Each row SHALL show the skill name, description, a source badge (bundled / user / override), and a runtime badge (native / omp / both). The tab SHALL show a friendly empty state when no skills are resolved and an error state when the backend call fails.

#### Scenario: Skills listed
- **WHEN** the user opens Settings → Skills with resolved skills present
- **THEN** each skill renders as a row with name, description, source badge, and runtime badge

#### Scenario: Empty state
- **WHEN** no skills are resolved
- **THEN** the tab shows an explanatory empty state instead of a blank panel

### Requirement: Skill content preview
Each skill row SHALL provide a preview action that opens a modal showing the skill's markdown content read via `read_resolved_skill`. The preview SHALL be read-only, scrollable, and closable via Escape and a close button.

#### Scenario: Preview opens
- **WHEN** the user clicks a skill's preview action
- **THEN** a modal opens showing the skill name and its full markdown content

#### Scenario: Preview close
- **WHEN** the user presses Escape or clicks the close button
- **THEN** the preview modal closes and the Skills tab remains
