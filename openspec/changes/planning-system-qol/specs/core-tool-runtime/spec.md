## ADDED Requirements

### Requirement: Deterministic deduplicated glob results
`list_files` and `search_files` glob matching SHALL return each matching
path exactly once, sorted, for any pattern including `**` segments. The
walker MUST NOT expand the `**` zero-directory branch once per directory
entry (the defect that produced mass-duplicated listings during testing).

#### Scenario: Recursive glob has no duplicates
- **WHEN** the agent calls `list_files` with `openspec/**/*.md` in a project
  containing nested change directories
- **THEN** every matching file appears exactly once and the list is sorted

#### Scenario: Zero-directory match counted once
- **WHEN** a pattern like `**/proposal.md` matches a file directly under a
  directory with N sibling entries
- **THEN** the file appears once, not up to N times
