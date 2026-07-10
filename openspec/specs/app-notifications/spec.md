# app-notifications Specification

## Requirements

### Requirement: Toast notifications for planning activity
The system SHALL render transient toast bubbles for notification-worthy
planning events: plan created, plan status changed, generation turn completed
(one summary toast per turn, not one per idea), run finished/failed, question
pending, schematic re-align suggested, and integration results. Toasts SHALL
stack without overlapping the composer, auto-dismiss after a short interval,
pause dismissal on hover, be manually dismissible, use 0px radius, and carry
`title=` tooltips on interactive elements. Clicking a toast SHALL navigate to
the subject (open the inspector tab, focus the chat panel, or open the plan).

#### Scenario: Plan created fires a toast
- **WHEN** an idea is promoted and a draft plan is created
- **THEN** a toast appears naming the plan; clicking it opens that plan in the
  planning surface

#### Scenario: Generation summarizes in one toast
- **WHEN** a generation turn captures six ideas
- **THEN** exactly one toast summarizes the turn ("6 ideas captured"), not six
  separate toasts

#### Scenario: Pending question surfaces from a background panel
- **WHEN** an agent asks a question in a chat panel that is not focused
- **THEN** a toast announces the pending question and clicking it focuses that
  chat panel

### Requirement: Persistent notification center
The system SHALL persist notifications locally (SQLite) and expose a
notification center with an unread count badge, newest-first list,
per-notification read state, mark-all-read, per-kind filtering, and
click-to-navigate. Notifications SHALL survive restart. Storage SHALL be
bounded (pruning oldest read entries beyond a cap). No notification data SHALL
leave the machine.

#### Scenario: Missed events are reviewable
- **WHEN** five runs finish while the user works in another panel and dismisses
  no toasts
- **THEN** the bell shows an unread count of at least five and the center
  lists each finish event with its outcome, newest first

#### Scenario: Unread survives restart
- **WHEN** the app restarts with three unread notifications
- **THEN** the bell shows three unread and the entries retain their read
  state and order

### Requirement: Per-kind notification settings
Settings SHALL offer per-kind delivery control (toast + center, center-only,
off) with conservative defaults: run finish/fail, plan created, pending
questions, and integration results default to toast + center; idea-level and
category-level events default to center-only. Changes SHALL apply immediately
without restart.

#### Scenario: Muting a kind stops its toasts
- **WHEN** the user sets "run finished" to center-only and a run finishes
- **THEN** no toast renders and the event still lands in the center as unread
