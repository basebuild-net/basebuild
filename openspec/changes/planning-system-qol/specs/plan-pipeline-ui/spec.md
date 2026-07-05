## ADDED Requirements

### Requirement: Structured plan proposal capture
Generate-plans runs SHALL return plan proposals as structured data (title,
description, goal, suggested change name) — via a dedicated propose-plans
tool exposed to the agent loop or a structured-output parse — and the chat
SHALL render them as selectable proposal cards. Free-text prose SHALL never
be the only artifact of a generation run.

#### Scenario: Proposals appear as cards
- **WHEN** a generate-plans run completes
- **THEN** each proposed plan renders as a card with title, summary, and an
  accept control, alongside (not buried inside) the assistant text

#### Scenario: Accepting creates draft plans
- **WHEN** the user accepts one or more proposal cards
- **THEN** each accepted proposal becomes a `draft` plan in the session
  (visible in the Plans panel without refresh) and the card shows its plan
  reference id

### Requirement: Proposal selection state persists
All proposals from a generation run — accepted and not accepted — SHALL be
persisted per session with their selection state and SHALL reload with the
session. Re-running generation SHALL append a new proposal set rather than
silently discarding the previous one.

#### Scenario: Unselected proposals survive restart
- **WHEN** the user accepts 2 of 5 proposals and restarts the app
- **THEN** reopening the session shows all 5 proposals with the same
  accepted/not-accepted states

#### Scenario: Accepted state links to plan
- **WHEN** a proposal was accepted and its plan later changes status
- **THEN** the proposal card reflects the linked plan's current status at
  read time (no duplicated status storage)
