## ADDED Requirements

### Requirement: Readable file viewing
Opening a file from the Files panel, Source panel, or a chat/tool link
SHALL render it appropriately by type: syntax-highlighted code/text
(virtualized for large files), rendered images, a markdown source↔preview
toggle for `.md`, and a size/type notice for unrenderable binaries.
Reopening an already-open path SHALL focus its existing tab instead of
duplicating it.

#### Scenario: Code file is highlighted
- **WHEN** the user clicks a `.ts` file in the Files panel
- **THEN** the file opens in a tab with syntax highlighting and line
  numbers, scrolling smoothly even for files with tens of thousands of
  lines

#### Scenario: Markdown preview toggle
- **WHEN** the user opens `AGENTS.md` and toggles preview
- **THEN** the tab switches between rendered markdown and highlighted
  source without losing scroll position

#### Scenario: One tab per path
- **WHEN** the user clicks a file whose tab is already open
- **THEN** the existing tab is focused; no duplicate tab is created

### Requirement: Lightweight text editing
Text files SHALL be editable in the file tab with an explicit save action
(Ctrl+S / save button), a visible dirty indicator, and a close-confirmation
when dirty. Saving SHALL fail safely with a conflict prompt when the file
changed on disk after it was opened (mtime guard) — never silently
overwrite external changes. There SHALL be no autosave and no writes
without explicit user action.

#### Scenario: Edit and save
- **WHEN** the user edits an open text file and presses Ctrl+S
- **THEN** the file is written to disk, the dirty indicator clears, and
  the save is visible in the Source panel's change list

#### Scenario: External change conflict
- **WHEN** the file was modified on disk (e.g. by an agent) while the tab
  has unsaved edits and the user saves
- **THEN** the app prompts with reload/overwrite/cancel options instead of
  silently overwriting

#### Scenario: Dirty close confirmation
- **WHEN** the user closes a tab with unsaved edits
- **THEN** a confirmation offers save/discard/cancel

### Requirement: Diff view for changed files
Clicking a changed file in the Source panel SHALL open its file tab in
diff mode showing a unified inline diff with surrounding context and a
toggle to the full current file. Staged, unstaged, and untracked files
SHALL all render (untracked as a full addition). The diff SHALL update
when the working tree changes while the tab is open.

#### Scenario: Changed file opens as diff
- **WHEN** the user clicks a modified file in the Source panel's Changes
  list
- **THEN** a file tab opens in diff mode showing added/removed lines with
  context, file path, and change type

#### Scenario: Untracked file diff
- **WHEN** the user clicks an untracked file in the Changes list
- **THEN** the diff renders the entire file as additions

#### Scenario: Diff follows the working tree
- **WHEN** the file changes on disk while its diff tab is open
- **THEN** the diff refreshes (or offers a one-click refresh) rather than
  showing stale hunks
