# plan-pipeline Specification (delta)

## REMOVED Requirements

### Requirement: Default category seeding
**Reason**: Hardcoded seed categories (SEO, Optimization, Design, New Features) ignore the project's domain and niche — exactly the generic drift the schematic exists to prevent. Categories become project-derived; see `Project-derived categories` below. Existing seeded categories in old sessions are user data and are not retro-deleted.

## ADDED Requirements

### Requirement: Project-derived categories
The system SHALL NOT seed or hardcode default idea categories. When category-directed planning is used for a session with no categories, the system SHALL present an empty state offering "Generate categories from project" (a recorded, skill-grounded generation stage) and manual "Add category" — and SHALL NOT silently create categories. Generated categories SHALL derive from project analysis (schematic Blueprint, Vision, End goals, Current priorities, and repository facts) so they reflect the project's actual domain. Re-running category generation SHALL append without duplicating existing categories (case-insensitive name match).

#### Scenario: Empty state instead of seeds
- **WHEN** the Categories view or category-directed generation is opened for a session with no categories
- **THEN** no categories are auto-created; the user sees "Generate categories from project" and "Add category" actions

#### Scenario: Generated categories reflect the project
- **WHEN** the user runs "Generate categories from project" for a niche project with a filled schematic
- **THEN** the created categories reflect that project's domain and priorities rather than a generic taxonomy, and the stage run records the created category ids

#### Scenario: Regeneration does not duplicate
- **WHEN** category generation runs for a session that already has categories
- **THEN** existing categories are preserved and no case-insensitive duplicate names are created

#### Scenario: Manual add always available
- **WHEN** the user adds a category manually in the empty state or alongside generated ones
- **THEN** the category is created immediately without any generation run
