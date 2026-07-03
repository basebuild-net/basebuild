## ADDED Requirements

### Requirement: Queue runs gate on review
For queued plan runs, final-touch steps that write outside the workspace history (git commit, pull request) SHALL execute only when the run's changeset is fully reviewed (every file approved or reverted) or the user explicitly skips review for that run. Ad-hoc chat sessions SHALL NOT be gated.

#### Scenario: Commit blocked until reviewed
- **WHEN** a queued run completes with pending review entries and a commit final-touch is enabled
- **THEN** the commit step waits in a `awaiting review` state, and executes automatically once the last file is approved

#### Scenario: Explicit skip
- **WHEN** the user chooses "skip review" on a queued run
- **THEN** the skip is recorded on the run (who/when), write steps proceed, and the changeset remains inspectable afterward

#### Scenario: Ad-hoc session not gated
- **WHEN** an ad-hoc chat session changes files
- **THEN** the review surface is available but nothing blocks; no gate state appears

### Requirement: Gate visibility
The queue UI SHALL show gate state per run (`awaiting review`, `reviewed`, `skipped`) and the queue SHALL continue starting subsequent plans while an earlier run awaits review.

#### Scenario: Queue does not stall
- **WHEN** run 1 awaits review and run 2 is next with free concurrency
- **THEN** run 2 starts; only run 1's write-side final touches wait
