# core-tool-runtime Specification (delta)

## ADDED Requirements

### Requirement: Sensitive-Path Redaction in Tool Events
The runtime SHALL redact file body content from tool events for
`write_file`/`edit_file` calls targeting sensitive paths (dotenv files,
private key material, SSH/AWS/GnuPG directories, credential stores and
databases under dot-directories): the `diff` field SHALL be omitted and
body arguments (`content`, `old_text`, `new_text`) SHALL be replaced
with a redaction marker before persist and emit. The target path and
byte counts SHALL remain visible for auditability.

#### Scenario: Agent writes a dotenv file
- **WHEN** the model calls `write_file` on `.env` with secret content
- **THEN** the persisted tool event and the emitted
  `native-chat://tool-event` carry no file body — no diff, redacted
  content argument — while path and size remain recorded

#### Scenario: Source file diffs are unaffected
- **WHEN** the model edits `src/main.rs`
- **THEN** the tool event carries the full unified diff as before

### Requirement: Bounded Pre-Image Reads for Diffing
`write_file` SHALL stat the existing target before reading it for diff
computation and SHALL skip the diff (recording no diff) when the file
exceeds the runtime's read cap. `edit_file` SHALL stat before reading and
SHALL reject files above the cap with an explicit error instead of
allocating unbounded memory.

#### Scenario: Write over a huge existing file
- **WHEN** the model calls `write_file` on a path holding a file larger
  than the read cap
- **THEN** the write succeeds, no pre-image is read into memory, and the
  tool event records no diff

#### Scenario: Edit a huge file
- **WHEN** the model calls `edit_file` on a file larger than the read cap
- **THEN** the call fails with an explicit size-limit error and no partial
  read or write occurs
