# Spec: plan-pipeline-ui

## Capability

`plan-pipeline-ui`

## Overview

A persistent, right-side plan panel that turns project goals into a managed pipeline of MVP plans. Plans move through `draft → openspec → waiting → in_progress → finished` and can be AI-generated, AI-enhanced, or manually created.

## Functional Requirements

1. The panel is always visible while a project is open and can be minimized to an icon-only strip.
2. Plans are grouped into lanes by status.
3. Each plan displays a stable reference id, title, priority, and quick actions.
4. Users can click any plan to open a modal for editing/focusing.
5. Users can create plans manually or generate them from a project goal via AI.
6. Users can request more plans based on the current plan set and goal.
7. Users can copy a plan reference id to inject it into a terminal/OMP session.
8. Finished plans collapse into a hidden pile.

## API Surface (frontend → Rust)

```ts
// Plan CRUD
listPlans(sessionId: string): Promise<Plan[]>
getPlan(id: string): Promise<Plan | null>
createPlan(plan: NewPlan): Promise<Plan>
updatePlan(id: string, patch: Partial<NewPlan>): Promise<Plan>
deletePlan(id: string): Promise<void>
setPlanStatus(id: string, status: PlanStatus): Promise<Plan>

// AI generation
export type GeneratePlansInput = {
  sessionId: string;
  projectPath: string;
  goal: string;
};

generatePlans(input: GeneratePlansInput): Promise<Plan[]>
suggestMorePlans(input: GeneratePlansInput & { existingPlanIds: string[] }): Promise<Plan[]>
enhancePlan(id: string): Promise<Plan>
```

## Data Model

See `design.md`.

## UI/UX

- Right-side panel width: 260px expanded, 36px collapsed.
- Each lane has a section label (uppercase, micro style) and count badge.
- Plan cards are 1px bordered, no radius, compact padding.
- Active/in-progress plan has an orange left border indicator.
- Hover reveals edit, focus, and status actions.
- Modal uses pure black background with 1px border and square corners.

## Dependencies

- `desktop-shell` layout
- `project-workspaces` for session/project scoping
- `basebuild-idea-generation` skill (evolved into plan generator skills)
- OMP CLI for AI generation calls

## Acceptance Criteria

- [ ] Opening a project shows the plan panel with lanes.
- [ ] Generating plans produces at least one draft plan from a user goal.
- [ ] Manually created plans save and appear in the draft lane.
- [ ] Plans can be moved through statuses and finished plans fold into the finished pile.
- [ ] Focus modal shows plan details and copy reference id action.
- [ ] TypeScript and Rust both compile.
