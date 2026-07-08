# schematic-inspector Specification

## MODIFIED Requirements

### Requirement: Structured schematic view
The system SHALL render the Project Schematic in a dedicated project modal with
health, section status, raw/edit actions, and a managed questionnaire/activity
region. Starting or continuing the wizard SHALL keep progress and `ask_user`
cards in that modal and SHALL NOT create a schematic workspace chat or route to
Plans & Ideas.

#### Scenario: User starts the schematic wizard
- **WHEN** the user opens Schematic and starts the wizard
- **THEN** repository-prefill activity and the next clickable question appear
  in the Schematic modal and the active chat/workspace remains unchanged

#### Scenario: User reopens an incomplete wizard
- **WHEN** a project has a pending schematic question and the user reopens the
  Schematic modal
- **THEN** the same pending run and question are restored without duplication

