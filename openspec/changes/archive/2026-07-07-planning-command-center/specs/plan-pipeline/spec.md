## ADDED Requirements

### Requirement: Batch idea approval
The system SHALL support approving multiple `concept` ideas in one action.
Each approved idea SHALL follow the existing single-idea promotion semantics
(idea → `picked`, linked draft plan created carrying title, description, and
category tag). The batch SHALL be processed per-idea — one failure SHALL NOT
abort the remaining promotions — and the result SHALL report created plan ids
and any per-idea failures. Batch approval SHALL emit the same planning events
as the equivalent individual actions, plus one batch-summary event.

#### Scenario: Batch promotes each selected idea
- **WHEN** four concept ideas are approved in one batch action
- **THEN** four draft plans exist, each idea is `picked` with a plan
  back-link, and the result lists the four plan ids

#### Scenario: One bad idea does not sink the batch
- **WHEN** a batch of three contains one idea that no longer exists
- **THEN** the two valid ideas are promoted, and the result names the missing
  idea as failed with a reason
