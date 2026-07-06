## ADDED Requirements

### Requirement: Typed planning events on every mutation
The backend SHALL emit a typed event on one channel (`planning://event`) for
every planning domain mutation: plan created/updated/status-changed, idea
captured/status-changed, category created/updated, schematic written, pipeline
stage started/succeeded/failed/cancelled, plan run started/finished/failed,
and integration actions. Each event SHALL carry a kind, entity id, project
path, session id when applicable, a human-readable title, an optional detail,
a per-app-run monotonic sequence number, and a timestamp. Event payloads SHALL
NOT contain prompt text, file contents, secrets, or raw absolute paths beyond
the project path itself.

#### Scenario: Plan status change emits an event
- **WHEN** a plan moves from `ready` to `running`
- **THEN** one `plan_status_changed` event is emitted carrying the plan id,
  both statuses, the plan title, and a sequence number greater than any prior
  event this app run

#### Scenario: Idea capture emits an event
- **WHEN** `propose_ideas` persists a new idea during a generation turn
- **THEN** an `idea_captured` event is emitted with the idea id, title, and
  owning session id

#### Scenario: Schematic write emits an event
- **WHEN** the schematic file is written through the app
- **THEN** a `schematic_updated` event is emitted with the resulting health
  state

### Requirement: Frontend subscription drives live UI
The frontend SHALL provide one subscription point for planning events that
panels consume to refresh live. Consumers SHALL receive events in sequence
order; a gap or reconnect SHALL trigger a catalog refetch rather than silent
staleness.

#### Scenario: Inspector updates without manual refresh
- **WHEN** an idea is captured by a generation turn while the planning
  inspector is open
- **THEN** the Ideas tab reflects the new idea without the user reopening or
  manually refreshing the panel

#### Scenario: Missed events trigger refetch
- **WHEN** a subscriber observes a sequence gap (e.g. after webview reload)
- **THEN** it refetches the planning catalog instead of rendering stale counts
