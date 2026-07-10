# schematic-wizard Specification (delta)

## MODIFIED Requirements

### Requirement: Native Wizard Round Trip
The schematic wizard SHALL complete end to end on the native agent loop:
starting the wizard injects the `basebuild-project-schematic` skill as the
turn prompt; the agent interviews via `ask_user` question cards; answers
resolve the parked turn; the agent writes `.basebuild/project-schematic.md`
via the workspace-scoped `write_file` tool (or the schematic command);
the schematic tab and health badge refresh from the written file. The OMP
RPC path is not required for any wizard functionality.

#### Scenario: Wizard start injects the skill natively
- **WHEN** the user starts the wizard from the schematic tab on a native-profile chat
- **THEN** the resolved skill content is sent as the turn prompt on the native loop and the turn begins streaming

#### Scenario: Interview questions render and resolve
- **WHEN** the wizard turn calls `ask_user` with section questions
- **THEN** question cards render inline, the turn parks until answered, and submitted answers are returned to the same turn as structured results

#### Scenario: Approved write lands on disk
- **WHEN** the user approves the wizard's write of `.basebuild/project-schematic.md`
- **THEN** the file is written inside the workspace, a schematic-updated event is emitted, and the schematic tab shows the new content and recomputed health without an app restart

#### Scenario: Write respects the approval gateway
- **WHEN** the approval mode requires prompting for mutating tools
- **THEN** the schematic write prompts for approval and a denial leaves the existing schematic untouched with the turn continuing gracefully

#### Scenario: Cancelled interview leaves no partial write
- **WHEN** the user cancels an `ask_user` question mid-interview
- **THEN** the turn receives the cancellation, no schematic write occurs from unanswered sections, and the previous schematic remains intact
