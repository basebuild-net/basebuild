# Design: AI Workbench Course Correction

## Product hierarchy

The shell has four ownership levels:

1. Global navigation: project/chat history and account controls.
2. Project command strip: Schematic, Ideas, Plans, Running, Done, Changes.
3. Active chat: transcript/activity timeline and composer.
4. Project modals: Schematic, Planning, Changes, Files, and Settings.

A control belongs to one level only. A stage button opens its exact destination;
it never creates a surrogate chat or defaults to a sibling tab.

The top bar is an orientation/action strip, not a telemetry dump. It contains
named project utilities, project/branch/workspace context, and planning stages.
Provider/model/effort live in the composer configuration area; raw session ids,
inactive-plan placeholders, and duplicate model/project badges do not render.

## Modal versus popover

Use a popover only for a short, single-step choice that can be understood in
roughly 6-8 rows (chat actions, branch switch, New panel). Use a modal for
search/browse configuration, multi-column content, previews, forms, or catalogs
(provider/model, Schematic, Planning, Changes, Files, Settings). Modal layouts
may obscure the chat: focused configuration is the current task.

## Agent activity model

Normalize native and OMP-backed events into ordered activity items:
`assistant_text`, `reasoning`, `tool_call`, `question`, `capture`, `approval`,
`notice`, and `error`. Each item carries a stable id, sequence, status, summary,
timestamps, and optional expandable detail. Unsupported transports produce an
explicit capability state before launch, not a fake tools-capable run.

The collapsed presentation is dense: one live activity group with the latest
operation visible. Expansion preserves ordering and exposes individual calls.
Question/approval cards remain inline and block the run visibly.

## Provider and model selection

Catalog data remains authoritative. The picker derives:

- connected providers, then available providers;
- only models owned by the selected provider;
- tool/planning/reasoning/effort badges from effective transport capability;
- session-level selection first, project default second, safe catalog fallback
  last.

Changing provider selects a compatible model from that provider but does not
silently persist it as the project default. Persistence occurs on the session
record immediately and is restored before the composer paints.

Provider cards use redundant state cues: green rail/dot + Connected label,
grey rail/dot + Available label, model count, and selected border. Color never
acts alone. The modal shows providers in a dense grid and models in an adjacent
searchable pane with tools/reasoning/effort badges.

## AI-only planning

The plan catalog has no blank-create affordance. A plan originates from:

- promotion of one or more structured ideas into an AI generation run; or
- import of existing complete artifacts.

The generation run exposes engine, provider, model, effort, and skill; produces
previewable artifacts; supports feedback/revision; validates; then enables an
explicit approval to `ready`. Editing metadata on an existing plan remains
available, but cannot bypass artifact validation.

## Responsive behavior

Modals use a column layout only for small widths. Settings is a fixed-width nav
beside a flexible content column. Planning modal tabs remain horizontal and
content fills the modal; container queries SHALL not switch modal children into
an unintended master/detail row. At 960x640, all required controls remain
visible or scroll within their owned region.

## Loading and errors

Project switching immediately replaces project content with a stable loading
surface. Modal bodies use visible skeleton/loading/error/empty states; Suspense
fallbacks for user-opened surfaces are never `null`. Errors include a retry and
are debug-logged with action and project/session identifiers.

## Migration

This change is additive to stored data. Existing manually-created draft plans
remain visible and editable, but the UI no longer offers creation of new blank
plans. Existing session provider/model values are preferred when valid and
repaired to a visible compatible fallback when invalid.
