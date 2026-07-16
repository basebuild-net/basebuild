export type MvpFixtureProject = {
  path: string;
  name: string;
  lastOpenedAt: number;
  lastActiveSessionId: string | null;
};

export type MvpFixtureSession = {
  id: string;
  projectPath: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type MvpFixtureTab = {
  id: string;
  sessionId: string;
  kind: "terminal" | "empty" | "file" | "chat" | "omp";
  title: string;
  terminalId: number | null;
  filePath: string | null;
  chatSessionId: string | null;
  createdAt: number;
};

export type MvpFixtureCategory = {
  id: string;
  sessionId: string;
  name: string;
  description: string;
  createdAt: number;
};

export type MvpFixtureIdea = {
  id: string;
  sessionId: string;
  categoryId: string | null;
  title: string;
  description: string;
  status: string;
  createdAt: number;
  updatedAt: number;
};

export type MvpFixturePlan = {
  id: string;
  sessionId: string;
  referenceId: string;
  title: string;
  description: string;
  goal: string | null;
  status: "draft" | "openspec" | "ready" | "running" | "finished" | "cancelled";
  priority: number;
  tags: string[];
  aiEnhanced: boolean;
  context: null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
};

const T0 = 1_800_000_000;

export const MVP_FIXTURE_PROJECTS: MvpFixtureProject[] = [
  { path: "C:\\basebuild-e2e\\alpha", name: "alpha", lastOpenedAt: T0 - 300, lastActiveSessionId: "mvp-session-alpha" },
  { path: "C:\\basebuild-e2e\\bravo", name: "bravo", lastOpenedAt: T0 - 200, lastActiveSessionId: "mvp-session-bravo" },
  { path: "C:\\basebuild-e2e\\charlie", name: "charlie", lastOpenedAt: T0 - 100, lastActiveSessionId: "mvp-session-charlie" },
];

export const MVP_FIXTURE_SESSIONS: MvpFixtureSession[] = [
  { id: "mvp-session-alpha", projectPath: "C:\\basebuild-e2e\\alpha", title: "Alpha baseline chat", createdAt: T0 - 300, updatedAt: T0 - 280 },
  { id: "mvp-session-bravo", projectPath: "C:\\basebuild-e2e\\bravo", title: "Bravo baseline chat", createdAt: T0 - 200, updatedAt: T0 - 180 },
  { id: "mvp-session-charlie", projectPath: "C:\\basebuild-e2e\\charlie", title: "Charlie MVP chat", createdAt: T0 - 100, updatedAt: T0 - 80 },
];

export const MVP_FIXTURE_TABS: MvpFixtureTab[] = [
  { id: "mvp-tab-alpha-chat", sessionId: "mvp-session-alpha", kind: "chat", title: "Alpha chat", terminalId: null, filePath: null, chatSessionId: null, createdAt: T0 - 300 },
  { id: "mvp-tab-bravo-chat", sessionId: "mvp-session-bravo", kind: "chat", title: "Bravo chat", terminalId: null, filePath: null, chatSessionId: null, createdAt: T0 - 200 },
  { id: "mvp-tab-charlie-chat", sessionId: "mvp-session-charlie", kind: "chat", title: "Charlie implementation chat", terminalId: null, filePath: null, chatSessionId: "nchat_mvp-charlie", createdAt: T0 - 100 },
  { id: "mvp-tab-charlie-schematic", sessionId: "mvp-session-charlie", kind: "empty", title: "Project schematic", terminalId: null, filePath: null, chatSessionId: null, createdAt: T0 - 90 },
];

export const MVP_FIXTURE_CATEGORIES: MvpFixtureCategory[] = [
  { id: "mvp-cat-workflow", sessionId: "mvp-session-charlie", name: "Workflow reliability", description: "Remove stale state and silent planning failures.", createdAt: T0 - 70 },
  { id: "mvp-cat-coordination", sessionId: "mvp-session-charlie", name: "Worker coordination", description: "Make safe parallel work inspectable and mergeable.", createdAt: T0 - 69 },
  { id: "mvp-cat-compact", sessionId: "mvp-session-charlie", name: "Compact desktop UX", description: "Keep the MVP journey usable at 960x640.", createdAt: T0 - 68 },
];

export const MVP_FIXTURE_IDEAS: MvpFixtureIdea[] = [
  { id: "mvp-idea-activation", sessionId: "mvp-session-charlie", categoryId: "mvp-cat-workflow", title: "Atomic project activation", description: "Gate restore work behind a generation token and loading boundary.", status: "picked", createdAt: T0 - 60, updatedAt: T0 - 55 },
  { id: "mvp-idea-popovers", sessionId: "mvp-session-charlie", categoryId: "mvp-cat-compact", title: "Viewport-safe popovers", description: "Clamp menus to the viewport and keep keyboard access.", status: "concept", createdAt: T0 - 59, updatedAt: T0 - 59 },
  { id: "mvp-idea-run-board", sessionId: "mvp-session-charlie", categoryId: "mvp-cat-coordination", title: "Shared run board", description: "Use file claims and blockers instead of cross-agent prose.", status: "concept", createdAt: T0 - 58, updatedAt: T0 - 58 },
];

export const MVP_FIXTURE_PLANS: MvpFixturePlan[] = [
  { id: "mvp-plan-activation", sessionId: "mvp-session-charlie", referenceId: "MVP-001", title: "Atomic activation", description: "Persist last focus and ignore stale restore responses.", goal: "Restore only the selected project generation.", status: "ready", priority: 10, tags: ["src/components/layout/AppShell.tsx"], aiEnhanced: false, context: null, createdAt: T0 - 50, updatedAt: T0 - 45, finishedAt: null },
  { id: "mvp-plan-popovers", sessionId: "mvp-session-charlie", referenceId: "MVP-002", title: "Clamp shell popovers", description: "Replace fixed menu math with viewport-clamped geometry.", goal: "Account menu remains visible at 960x640.", status: "ready", priority: 20, tags: ["src/components/layout/AccountButton.tsx"], aiEnhanced: false, context: null, createdAt: T0 - 49, updatedAt: T0 - 44, finishedAt: null },
  { id: "mvp-plan-conflict", sessionId: "mvp-session-charlie", referenceId: "MVP-003", title: "Conflicting planning router", description: "Route category and idea actions through one chat delivery path.", goal: "Expose collision with activation work for safe scheduling.", status: "ready", priority: 30, tags: ["src/components/layout/AppShell.tsx"], aiEnhanced: false, context: null, createdAt: T0 - 48, updatedAt: T0 - 43, finishedAt: null },
];

export const MVP_FIXTURE_SCHEMATIC = `# Project Schematic: MVP Fixture

## Purpose
Basebuild wraps local AI coding agents in a desktop control plane.

## Vision
A user can go from project folder to reviewed multi-agent work without stale state or hidden automation.

## Architecture
React + Tauri + SQLite with OpenSpec artifacts and local mock providers for tests.

## Constraints
Local-first. No network upload. Every decision path should use managed cards or pickers.
`;

export const MVP_BASELINE_TIMINGS = {
  clickToFeedbackBudgetMs: 100,
  activationUsableBudgetMs: 1000,
  baselineRendererChunkKb: 814.47,
};
