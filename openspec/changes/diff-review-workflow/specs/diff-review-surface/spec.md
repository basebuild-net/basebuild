## ADDED Requirements

### Requirement: Per-file diff review
The review surface SHALL list a run's changed files with status badges and show a unified diff per file against the run baseline. Actions per file: approve, revert, send-back-to-chat; bulk actions: approve all, revert all (revert-all requires confirmation). All interactive elements SHALL have tooltips and follow the single-stylesheet, 0px-radius contract.

#### Scenario: Review a run
- **WHEN** the user opens review on a completed run with 5 changed files
- **THEN** all 5 appear with add/modify/delete badges, each expandable to a diff vs baseline

#### Scenario: File-level revert
- **WHEN** the user reverts a `modified` file
- **THEN** its baseline content is restored; reverting an `added` file deletes it; reverting a `deleted` file restores it — and the entry is marked `reverted`

#### Scenario: Revert with newer local edits
- **WHEN** a file changed on disk after the run completed (user or another run touched it)
- **THEN** revert warns that post-run edits will be lost and requires confirmation before restoring baseline content

### Requirement: Send back to chat
Send-back-to-chat SHALL post the file's diff and the user's note into the run's chat session as a follow-up prompt, so the agent can amend its own work in context.

#### Scenario: Request a fix
- **WHEN** the user sends a file back with note "wrong error type"
- **THEN** the run session receives the diff plus note as a message, and the file's review state resets to pending after the agent's next change to it

### Requirement: Review state persistence
Per-file review states (`pending`, `approved`, `reverted`) SHALL persist on the run record and survive app restart; the run card SHALL summarize progress (e.g. `3/5 reviewed`).

#### Scenario: Resume review after restart
- **WHEN** the user approves 3 of 5 files and restarts the app
- **THEN** the review surface reopens with the same 3 approved and 2 pending
