## ADDED Requirements

### Requirement: Decision-history and preferences steering
Generation instruction assembly SHALL extend the focus directive with (a) the
bounded decision digest (recent picked ideas, recent rejected ideas, plans
finished since the schematic was last written) and (b) the content of
`.basebuild/preferences.md` when present. Both inputs derive from local data
only. Their absence SHALL NOT block generation — the directive simply omits
the missing part.

#### Scenario: Digest and preferences in the directive
- **WHEN** a generation turn is assembled for a project with decided ideas and
  a preferences file
- **THEN** the effective instructions contain the decision digest and the
  preferences content after the schematic focus directive

#### Scenario: Absence degrades gracefully
- **WHEN** a project has no decided ideas and no preferences file
- **THEN** generation runs with the schematic focus directive alone, with no
  error or placeholder text
