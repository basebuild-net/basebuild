## ADDED Requirements

### Requirement: Schema-version-tolerant telemetry parsing

The telemetry reader SHALL parse the usage/stats JSON shapes emitted by
currently supported omp versions — including the omp 16.x shape where
window utilization lives in `reports[].limits[]` (per-provider reports
with per-limit `window` objects) — in addition to legacy top-level
`windows`/`usage` arrays. When JSON is returned but no known shape
matches, the HUD SHALL show an explicit parse-mismatch state naming the
detected omp version (e.g. "telemetry format not recognized — omp 16.3.6")
instead of the generic "Detached: No OMP session data found".

#### Scenario: omp 16.x usage shape parses

- **WHEN** `omp usage --json` returns `reports[].limits[]` entries with
  window utilization and reset timestamps
- **THEN** the OMP tab HUD shows per-window utilization bars instead of a
  detached state

#### Scenario: Unknown shape is named, not masked

- **WHEN** `omp usage --json` returns valid JSON in a shape the parser
  does not recognize
- **THEN** the HUD shows a parse-mismatch state that includes the omp
  version, and the raw probe error is available in the debug/log surface
