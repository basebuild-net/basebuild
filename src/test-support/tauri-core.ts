import {
  MVP_BASELINE_TIMINGS,
  MVP_FIXTURE_CATEGORIES,
  MVP_FIXTURE_IDEAS,
  MVP_FIXTURE_PLANS,
  MVP_FIXTURE_PROJECTS,
  MVP_FIXTURE_SCHEMATIC,
  MVP_FIXTURE_SESSIONS,
  MVP_FIXTURE_TABS,
} from "./fixture-data";
import { __emit } from "./tauri-event";

type Session = {
  id: string;
  projectPath: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

type SessionTab = {
  id: string;
  sessionId: string;
  kind: "terminal" | "empty" | "file" | "chat" | "omp";
  title: string;
  terminalId: number | null;
  filePath: string | null;
  chatSessionId: string | null;
  createdAt: number;
};
type NativeChatSession = {
  id: string;
  projectPath: string;
  title: string;
  profileId: string;
  providerId: string;
  modelId: string;
  effortLevel: string;
  status: string;
  runState: string;
  createdAt: number;
  updatedAt: number;
};

type NativeChatMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string | null;
  sortOrder: number;
  providerId: string | null;
  modelId: string | null;
  effortLevel: string | null;
  createdAt: number;
};

type NativeRequestMetric = {
  id: string;
  sessionId: string;
  providerId: string;
  modelId: string;
  effortLevel: string;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  ttftMs: number | null;
  ttltMs: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  tokensPerSecond: number | null;
  costTotal: number | null;
  outcome: string;
  errorClass: string | null;
  createdAt: number;
};

type NativeToolEvent = {
  id: string;
  sessionId: string;
  messageId: string | null;
  kind: string;
  status: string;
  summary: string;
  arguments: string | null;
  diff: string | null;
  decision: string | null;
  ruleSource: string | null;
  sequence: number;
  createdAt: number;
};

type Idea = {
  id: string;
  sessionId: string;
  categoryId: string | null;
  title: string;
  description: string;
  status: string;
  createdAt: number;
  updatedAt: number;
};

type Category = {
  id: string;
  sessionId: string;
  name: string;
  description: string;
  createdAt: number;
};


type Plan = {
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

type E2eState = {
  projectPath: string;
  sessions: Session[];
  tabs: SessionTab[];
  plans: Plan[];
  nextSessionId: number;
  nextTabId: number;
  nextPlanId: number;
  nextTerminalId: number;
  nextNativeChatId: number;
  nextNativeMessageId: number;
  nextNativeMetricId: number;
  nativeChatSessions: NativeChatSession[];
  nativeToolEvents: NativeToolEvent[];
  nativeChatMessages: NativeChatMessage[];
  nativeRequestMetrics: NativeRequestMetric[];
  categories: Category[];
  ideas: Idea[];
  nextCategoryId: number;
  nextIdeaId: number;
  planQueue: { id: string; sessionId: string; planId: string; sortOrder: number; createdAt: number }[];
  planRuns: { id: string; planId: string; sessionId: string; chatSessionId?: string; status: string; runnerKind: string; error?: string; stepsOutput: unknown[]; startedAt?: number; finishedAt?: number; createdAt: number }[];
  planDependencies?: Map<string, { prerequisites: string[]; affectedPaths: string[]; schedulingMode: string; workspacePolicy: string }>;
  workspaceRestoreByProject: Map<string, unknown>;
  recentProjects: { path: string; name: string; lastOpenedAt: number; lastActiveSessionId: string | null }[];
  pickProjectCalls: number;
  fixtureName: string | null;
  auth: { accessToken: string; expiresAt: string; scopes: string[]; user: { id: string; username: string; email: string; image: string | null; isAdmin: boolean; isEditor: boolean } | null } | null;
  updateInstallCount: number;
  autoSyncEnabled?: boolean;
  gitChangeStaged: boolean;
  terminals: { id: number; shell: string; cwd: string | null; pid: number; rows: number; cols: number; startedAt: number; alive: boolean }[];
  notifications: { id: string; kind: string; entityId: string; entityKind: string; projectPath: string; title: string; detail?: string; read: boolean; createdAt: number }[];
  credentials: Map<string, { providerId: string; apiKey: string; baseUrl: string | null; updatedAt: number }>;
  blockedProviders: Set<string>;
  notificationSettings: { overrides: Record<string, string> };
};

const globalState = globalThis as typeof globalThis & { __BASEBUILD_E2E_STATE__?: E2eState; __BASEBUILD_E2E_FIXTURE__?: string; __BASEBUILD_E2E_PICK_PROJECT_PATH__?: string; __BASEBUILD_E2E_PICKER_DELAY_MS__?: number; __BASEBUILD_E2E_RESTORE_DELAY_MS__?: number };


function panelGridFor(panelId: string, chatSessionId: string | null = null): string {
  return JSON.stringify({
    root: {
      kind: "leaf",
      panel: {
        id: panelId,
        type: "chat",
        title: "Chat",
        chatSessionId,
        terminalId: null,
        filePath: null,
      },
    },
    activePanelId: panelId,
    closedPanels: [],
  });
}

function applyMvpFixture(s: E2eState): void {
  s.fixtureName = "mvp-baseline";
  s.projectPath = MVP_FIXTURE_PROJECTS[2]?.path ?? s.projectPath;
  s.recentProjects = MVP_FIXTURE_PROJECTS.map((project) => ({ ...project }));
  s.sessions = MVP_FIXTURE_SESSIONS.map((session) => ({ ...session }));
  s.tabs = MVP_FIXTURE_TABS.map((tab) => ({ ...tab }));
  s.categories = MVP_FIXTURE_CATEGORIES.map((category) => ({ ...category }));
  s.ideas = MVP_FIXTURE_IDEAS.map((idea) => ({ ...idea }));
  s.plans = MVP_FIXTURE_PLANS.map((plan) => ({ ...plan }));
  s.nativeChatSessions = [
    {
      id: "mvp-native-charlie",
      projectPath: "C:\\basebuild-e2e\\charlie",
      title: "Charlie MVP chat",
      profileId: "basebuild-native",
      providerId: "umans",
      modelId: "umans-glm-5.2",
      effortLevel: "high",
      status: "ready",
      runState: "idle",
      createdAt: 1_800_000_000,
      updatedAt: 1_800_000_000,
    },
  ];
  s.nativeChatMessages = [
    {
      id: "mvp-msg-user",
      sessionId: "mvp-native-charlie",
      role: "user",
      content: "Start MVP baseline",
      sortOrder: 0,
      providerId: "umans",
      modelId: "umans-glm-5.2",
      effortLevel: "high",
      createdAt: 1_800_000_000,
    },
  ];
  s.workspaceRestoreByProject.set("C:\\basebuild-e2e\\alpha", {
    projectPath: "C:\\basebuild-e2e\\alpha",
    lastSessionId: "mvp-session-alpha",
    lastTabId: "mvp-tab-alpha-chat",
    sideSection: "plans",
    sidebarCollapsed: false,
    sideCollapsed: false,
    sideWidth: 260,
    panelGrid: panelGridFor("mvp-panel-alpha"),
    updatedAt: 1_800_000_000,
  });
  s.workspaceRestoreByProject.set("C:\\basebuild-e2e\\bravo", {
    projectPath: "C:\\basebuild-e2e\\bravo",
    lastSessionId: "mvp-session-bravo",
    lastTabId: "mvp-tab-bravo-chat",
    sideSection: "plans",
    sidebarCollapsed: false,
    sideCollapsed: false,
    sideWidth: 260,
    panelGrid: panelGridFor("mvp-panel-bravo"),
    updatedAt: 1_800_000_000,
  });
  s.workspaceRestoreByProject.set("C:\\basebuild-e2e\\charlie", {
    projectPath: "C:\\basebuild-e2e\\charlie",
    lastSessionId: "mvp-session-charlie",
    lastTabId: "mvp-tab-charlie-schematic",
    sideSection: "plans",
    sidebarCollapsed: false,
    sideCollapsed: false,
    sideWidth: 260,
    panelGrid: panelGridFor("mvp-panel-charlie", "mvp-native-charlie"),
    updatedAt: 1_800_000_000,
  });
  s.auth = {
    accessToken: "mvp-test-token",
    expiresAt: "2026-12-31T00:00:00Z",
    scopes: ["profile:read"],
    user: { id: "mvp-user", username: "MVPUser", email: "mvp@example.test", image: null, isAdmin: false, isEditor: false },
  };
}

function state(): E2eState {
  if (!globalState.__BASEBUILD_E2E_STATE__) {
    globalState.__BASEBUILD_E2E_STATE__ = {
      projectPath: "C:\\basebuild-e2e\\project",
      sessions: [],
      tabs: [],
      plans: [],
      nextSessionId: 1,
      nextTabId: 1,
      nextPlanId: 1,
      nextTerminalId: 1,
      nextNativeChatId: 1,
      nextNativeMessageId: 1,
      nextNativeMetricId: 1,
      nativeChatSessions: [],
      nativeChatMessages: [],
      nativeRequestMetrics: [],
      nativeToolEvents: [],
      categories: [],
      ideas: [],
      nextCategoryId: 1,
      nextIdeaId: 1,
      planQueue: [],
      planRuns: [],
      workspaceRestoreByProject: new Map(),
      recentProjects: [],
      pickProjectCalls: 0,
      fixtureName: null,
      auth: null,
      updateInstallCount: 0,
      gitChangeStaged: false,
      terminals: [],
      notifications: [],
      // Seed umans as connected so disconnect tests have a provider to work with.
      credentials: new Map([
        ["umans", { providerId: "umans", apiKey: "test-key", baseUrl: null, updatedAt: 1_800_000_000 }],
      ]),
      blockedProviders: new Set(),
      notificationSettings: { overrides: {} },
    };
    if (globalState.__BASEBUILD_E2E_FIXTURE__ === "mvp-baseline") {
      applyMvpFixture(globalState.__BASEBUILD_E2E_STATE__);
    }
  }
  return globalState.__BASEBUILD_E2E_STATE__!;
}

function makeSession(projectPath: string, title: string): Session {
  const s = state();
  const id = `session-${s.nextSessionId++}`;
  const ts = Math.floor(Date.now() / 1000);
  return { id, projectPath, title, createdAt: ts, updatedAt: ts };
}

function makePlan(sessionId: string, input: Partial<Plan> & { title: string; description: string }): Plan {
  const s = state();
  const index = s.nextPlanId++;
  const ts = Math.floor(Date.now() / 1000);
  return {
    id: `plan-${index}`,
    sessionId,
    referenceId: `PLAN-${index}`,
    title: input.title,
    description: input.description,
    goal: input.goal ?? null,
    status: input.status ?? "draft",
    priority: input.priority ?? 50,
    tags: input.tags ?? [],
    aiEnhanced: false,
    context: null,
    createdAt: ts,
    updatedAt: ts,
    finishedAt: null,
  };
}

export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const s = state();

  switch (command) {
    case "list_recent_projects":
      return s.recentProjects.slice(0, Number(args.limit ?? 10)) as T;
    case "pick_project_directory": {
      s.pickProjectCalls += 1;
      const delayMs = globalState.__BASEBUILD_E2E_PICKER_DELAY_MS__ ?? 0;
      if (delayMs > 0) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, delayMs);
        await promise;
      }
      return (globalState.__BASEBUILD_E2E_PICK_PROJECT_PATH__ ?? s.projectPath) as T;
    }
    case "remember_recent_project": {
      const path = args.path as string;
      s.projectPath = path;
      const name = path.split("\\").pop() || "project";
      const existing = s.recentProjects.find((project) => project.path === path);
      const project = { path, name, lastOpenedAt: Math.floor(Date.now() / 1000), lastActiveSessionId: existing?.lastActiveSessionId ?? null };
      s.recentProjects = [project, ...s.recentProjects.filter((item) => item.path !== path)];
      return project as T;
    }
    case "get_last_focused_project": {
      const focusedPath = typeof localStorage !== "undefined" ? localStorage.getItem("basebuild:last-focused-project") : null;
      const path = focusedPath ?? (s.fixtureName === "mvp-baseline" ? s.projectPath : s.recentProjects[0]?.path) ?? null;
      return (path ? s.recentProjects.find((project) => project.path === path) ?? null : null) as T;
    }
    case "set_last_focused_project": {
      const path = args.path as string;
      if (typeof localStorage !== "undefined") localStorage.setItem("basebuild:last-focused-project", path);
      s.projectPath = path;
      const existing = s.recentProjects.find((project) => project.path === path);
      const name = path.split("\\").pop() || "project";
      const project = { path, name, lastOpenedAt: Math.floor(Date.now() / 1000), lastActiveSessionId: existing?.lastActiveSessionId ?? null };
      s.recentProjects = [project, ...s.recentProjects.filter((item) => item.path !== path)];
      return project as T;
    }
    case "remove_recent_project":
      s.recentProjects = s.recentProjects.filter((project) => project.path !== args.path);
      return undefined as T;
    case "set_last_active_session": {
      const project = s.recentProjects.find((item) => item.path === args.projectPath);
      if (project) project.lastActiveSessionId = args.sessionId as string;
      return undefined as T;
    }
    case "reveal_in_explorer":
    case "set_project_schematic":
    case "delete_tab":
    case "write_terminal":
    case "resize_terminal":
    case "close_terminal": {
      const idx = s.terminals.findIndex((t) => t.id === args.id);
      if (idx >= 0) s.terminals.splice(idx, 1);
      return undefined as T;
    }
    case "agent_stop":
      return undefined as T;
    case "native_chat_cancel":
      return true as T;
    case "native_chat_resolve_approval":
      return true as T;
    case "native_chat_tool_events":
      return s.nativeToolEvents
        .filter((e) => e.sessionId === (args.sessionId as string))
        .slice()
        .sort((a, b) => a.sequence - b.sequence) as T;
    case "native_chat_clear_messages": {
      const sessionId = args.sessionId as string;
      const removed = s.nativeChatMessages.filter((m) => m.sessionId === sessionId).length;
      s.nativeChatMessages = s.nativeChatMessages.filter((m) => m.sessionId !== sessionId);
      s.nativeToolEvents = s.nativeToolEvents.filter((e) => e.sessionId !== sessionId);
      return removed as T;
    }
    case "native_chat_update_session_model": {
      const sessionId = args.sessionId as string;
      const session = s.nativeChatSessions.find((c) => c.id === sessionId);
      if (!session) throw new Error(`native_chat_update_session_model: unknown session ${sessionId}`);
      session.providerId = args.providerId as string;
      session.modelId = args.modelId as string;
      session.effortLevel = args.effortLevel as string;
      return { ...session } as T;
    }
    case "native_interaction_list_all":
    case "native_interaction_list_pending": {
      const w = globalThis as unknown as { __basebuildMockInteraction?: unknown };
      const injected = w.__basebuildMockInteraction;
      if (injected) {
        return [injected] as T;
      }
      return [] as T;
    }
    case "native_interaction_resolve": {
      const w = globalThis as unknown as { __basebuildMockInteraction?: { id: string; status: string; [k: string]: unknown } };
      if (w.__basebuildMockInteraction) w.__basebuildMockInteraction.status = "answered";
      return (w.__basebuildMockInteraction ?? { id: args.id as string, status: "answered" }) as T;
    }
    case "native_interaction_cancel": {
      const w = globalThis as unknown as { __basebuildMockInteraction?: { id: string; status: string; [k: string]: unknown } };
      if (w.__basebuildMockInteraction) w.__basebuildMockInteraction.status = "cancelled";
      return (w.__basebuildMockInteraction ?? { id: args.id as string, status: "cancelled" }) as T;
    }
    case "stability_list_reports":
      return [] as T;
    case "stability_read_report":
      return { id: "test", kind: "panic", timestamp: 0, summary: "Test", details: "Test", seen: false } as T;
    case "stability_delete_report":
    case "stability_mark_seen":
      return undefined as T;
    case "stability_unseen_count":
      return 0 as T;
    case "stability_recent_telemetry":
    case "stability_violations":
      return [] as T;
    case "detect_project":
      return { path: args.path as string, gitRoot: args.path as string, hasGit: true, hasOpenSpec: true, hasBasebuild: true } as T;
    case "git_status": {
      const file = {
        path: "src/components/panels/SourcePanel.tsx",
        indexStatus: s.gitChangeStaged ? "M" : null,
        worktreeStatus: s.gitChangeStaged ? null : "M",
        changeType: "modified",
        staged: s.gitChangeStaged,
      };
      return {
        branch: { branch: "main", ahead: 0, behind: 0, upstream: "origin/main" },
        staged: s.gitChangeStaged ? [file] : [],
        unstaged: s.gitChangeStaged ? [] : [file],
        untracked: [],
      } as T;
    }
    case "git_diff":
      return [
        "diff --git a/src/components/panels/SourcePanel.tsx b/src/components/panels/SourcePanel.tsx",
        "--- a/src/components/panels/SourcePanel.tsx",
        "+++ b/src/components/panels/SourcePanel.tsx",
        "@@ -448,7 +448,7 @@",
        "-                  <Sparkles size={12} /> Generate commit",
        "+                  <Sparkles size={12} /> Generate commit",
      ].join("\n") as T;
    case "git_add":
    case "git_stage_all":
      s.gitChangeStaged = true;
      return undefined as T;
    case "git_reset":
    case "git_unstage_all":
    case "git_discard":
      s.gitChangeStaged = false;
      return undefined as T;
    case "git_commit":
      s.gitChangeStaged = false;
      return "abc1234" as T;
    case "git_log":
      return [
        { hash: "abc1234", shortHash: "abc1234", message: "Initial commit", author: "Basebuild", date: "2026-07-01T00:00:00Z", parents: [], refs: ["HEAD -> main"] },
      ] as T;
    case "git_branch_list":
      return [{ name: "main", upstream: "origin/main", isCurrent: true }] as T;
    case "git_pull":
    case "git_push":
    case "git_fetch":
      return "Already up to date." as T;
    case "list_sessions":
      return s.sessions.filter((session) => session.projectPath === args.projectPath) as T;
    case "create_session": {
      const session = makeSession(args.projectPath as string, args.title as string);
      s.sessions.push(session);
      return session as T;
    }
    case "rename_session": {
      const session = s.sessions.find((item) => item.id === args.id);
      if (session) session.title = args.title as string;
      return undefined as T;
    }
    case "delete_session":
      s.sessions = s.sessions.filter((session) => session.id !== args.id);
      s.tabs = s.tabs.filter((tab) => tab.sessionId !== args.id);
      return undefined as T;
    case "list_tabs":
      return s.tabs.filter((tab) => tab.sessionId === args.sessionId) as T;
    case "create_tab": {
      const tab: SessionTab = {
        id: `tab-${s.nextTabId++}`,
        sessionId: args.sessionId as string,
        kind: args.kind as SessionTab["kind"],
        title: args.title as string,
        terminalId: (args.terminalId as number | null) ?? null,
        filePath: (args.filePath as string | null) ?? null,
        chatSessionId: (args.chatSessionId as string | null) ?? null,
        createdAt: Math.floor(Date.now() / 1000),
      };
      s.tabs.push(tab);
      return tab as T;
    }
    case "update_tab_terminal": {
      const tab = s.tabs.find((item) => item.id === args.id);
      if (tab) tab.terminalId = args.terminalId as number | null;
      return undefined as T;
    }
    case "update_tab_file_path": {
      const tab = s.tabs.find((item) => item.id === args.id);
      if (tab) tab.filePath = args.filePath as string | null;
      return undefined as T;
    }
    case "update_tab_chat_session": {
      const tab = s.tabs.find((item) => item.id === args.id);
      if (tab) tab.chatSessionId = args.chatSessionId as string | null;
      return undefined as T;
    }
    case "has_project_schematic":
      return true as T;
    case "get_project_schematic":
      return { content: s.fixtureName === "mvp-baseline" ? MVP_FIXTURE_SCHEMATIC : "# Project Schematic: E2E Fixture\n\n## Purpose\nExercise plan context generation." } as T;
    case "list_plans":
      return s.plans.filter((plan) => plan.sessionId === args.sessionId) as T;
    case "create_plan": {
      const input = args.input as { sessionId: string; title: string; description: string };
      const plan = makePlan(input.sessionId, input);
      s.plans.push(plan);
      return plan as T;
    }
    case "update_plan":
    case "set_plan_status":
    case "set_plan_context": {
      const plan = s.plans.find((item) => item.id === args.id);
      if (!plan) throw new Error(`Plan not found: ${String(args.id)}`);
      return plan as T;
    }
    case "delete_plan":
      s.plans = s.plans.filter((plan) => plan.id !== args.id);
      return undefined as T;
    case "plan_run_enqueue": {
      const { sessionId, planId } = args.request as { sessionId: string; planId: string };
      const entry = { id: `pq-${Date.now()}`, sessionId, planId, sortOrder: s.planQueue.filter((q) => q.sessionId === sessionId).length, createdAt: Date.now() };
      s.planQueue.push(entry);
      return entry as T;
    }
    case "plan_run_list_queue":
      return s.planQueue.filter((q) => q.sessionId === args.sessionId).sort((a, b) => a.sortOrder - b.sortOrder) as T;
    case "plan_run_reorder":
    case "plan_run_remove": {
      if (command === "plan_run_remove") {
        s.planQueue = s.planQueue.filter((q) => q.id !== args.entryId);
      } else {
        const entry = s.planQueue.find((q) => q.id === args.entryId);
        if (entry) entry.sortOrder = args.newOrder as number;
      }
      return undefined as T;
    }
    case "plan_run_start":
      return undefined as T;
    case "plan_assign_to_chat": {
      const planId = typeof args.planId === "string" ? args.planId : "";
      const chatSessionId = typeof args.chatSessionId === "string" ? args.chatSessionId : "";
      const run = { id: `run-${Date.now()}`, planId, sessionId: typeof args.sessionId === "string" ? args.sessionId : "", chatSessionId, workspacePath: undefined, status: "running", runnerKind: "native", error: undefined, stepsOutput: [], createdAt: Date.now() };
      s.planRuns.push(run);
      return run as T;
    }
    case "openspec_list_changes":
      return [] as T;
    case "openspec_parse_tasks_structured":
      return { phases: [], total: 0, completed: 0 } as T;
    case "openspec_read_tasks_structured":
      return { phases: [], total: 0, completed: 0 } as T;
    case "openspec_toggle_task":
      return undefined as T;
    case "openspec_archive_change":
      return undefined as T;
    case "openspec_link_change_to_plan":
      return undefined as T;
    case "openspec_unlink_plan_from_change":
      return undefined as T;
    case "openspec_refresh_task_progress":
      return false as T;
    case "plan_run_pause":
      return undefined as T;
    case "plan_run_cancel":
      return undefined as T;
    case "plan_run_complete":
      return undefined as T;
    case "plan_run_mark_complete":
      return undefined as T;
    case "plan_run_check_completion":
      return [0, 0] as T;
    case "plan_run_list":
      return s.planRuns.filter((r) => r.sessionId === args.sessionId) as T;
    case "plan_run_get":
      return (s.planRuns.find((r) => r.id === args.runId) ?? null) as T;
    case "plan_run_start_omp": {
      const { sessionId, planId } = args as { sessionId: string; planId: string };
      const run = { id: `run-${Date.now()}`, planId, sessionId, status: "running", runnerKind: "omp", error: undefined, stepsOutput: [], createdAt: Date.now() };
      s.planRuns.push(run);
      return run as T;
    }
    case "plan_set_dependencies": {
      const req = args.request as { planId: string; prerequisites?: string[]; affectedPaths?: string[]; priority?: number; schedulingMode?: string; workspacePolicy?: string };
      const plan = s.plans.find((p) => p.id === req.planId);
      if (!plan) throw new Error(`Plan not found: ${req.planId}`);
      if (req.priority !== undefined) plan.priority = req.priority;
      if (!s.planDependencies) s.planDependencies = new Map();
      const existing = s.planDependencies.get(req.planId) ?? { prerequisites: [], affectedPaths: [], schedulingMode: "safe", workspacePolicy: "isolated_worktrees" };
      s.planDependencies.set(req.planId, {
        prerequisites: req.prerequisites ?? existing.prerequisites,
        affectedPaths: req.affectedPaths ?? existing.affectedPaths,
        schedulingMode: req.schedulingMode ?? existing.schedulingMode,
        workspacePolicy: req.workspacePolicy ?? existing.workspacePolicy,
      });
      return plan as T;
    }
    case "plan_get_dependencies": {
      const planId = args.planId as string;
      const deps = s.planDependencies?.get(planId);
      const plan = s.plans.find((p) => p.id === planId);
      return (deps ? { planId, ...deps, priority: plan?.priority ?? 50 } : { planId, prerequisites: [], affectedPaths: [], priority: plan?.priority ?? 50, schedulingMode: "safe", workspacePolicy: "isolated_worktrees" }) as T;
    }
    case "plan_dependency_graph": {
      const sessionId = args.sessionId as string;
      const sessionPlans = s.plans.filter((p) => p.sessionId === sessionId);
      const nodes = sessionPlans.map((p) => {
        const deps = s.planDependencies?.get(p.id);
        const prerequisites = deps?.prerequisites ?? [];
        const affectedPaths = deps?.affectedPaths ?? [];
        const schedulingMode = deps?.schedulingMode ?? "safe";
        const collisions: string[] = [];
        for (const other of sessionPlans) {
          if (other.id === p.id) continue;
          const otherDeps = s.planDependencies?.get(other.id);
          const otherPaths = otherDeps?.affectedPaths ?? [];
          if (affectedPaths.some((ap) => otherPaths.includes(ap))) collisions.push(other.id);
        }
        const unmet = prerequisites.filter((pid) => {
          const prereq = s.plans.find((pp) => pp.id === pid);
          return !prereq || prereq.status !== "finished";
        });
        const runningCollisions = collisions.filter((cid) => {
          const cp = s.plans.find((pp) => pp.id === cid);
          return cp?.status === "running";
        });
        const readiness = p.status === "finished" ? "finished" : p.status === "cancelled" ? "cancelled" : p.status === "running" ? "running" : unmet.length > 0 ? "blocked" : (schedulingMode !== "yolo" && runningCollisions.length > 0) ? "blocked" : "ready";
        const blockReason = readiness === "blocked" ? (unmet.length > 0 ? `Waiting on prerequisites: ${unmet.join(", ")}` : `File collision with running plan(s): ${runningCollisions.join(", ")}`) : undefined;
        return { planId: p.id, referenceId: p.referenceId, title: p.title, status: p.status, priority: p.priority, prerequisites, affectedPaths, readiness, blockReason, collisions, dispatchable: readiness === "ready", yoloConfirmed: schedulingMode === "yolo" };
      });
      nodes.sort((a, b) => b.priority - a.priority);
      return { sessionId, nodes, cycles: [] } as T;
    }
    case "plan_validate_readiness": {
      const planId = args.planId as string;
      const plan = s.plans.find((p) => p.id === planId);
      if (!plan) return { planId, valid: false, errors: ["Plan not found"], warnings: [] } as T;
      const errors: string[] = [];
      const warnings: string[] = [];
      if (plan.status !== "ready" && plan.status !== "openspec") errors.push(`Plan status is ${plan.status} — must be ready or openspec to dispatch.`);
      const deps = s.planDependencies?.get(planId);
      if (deps) {
        for (const pid of deps.prerequisites) {
          const prereq = s.plans.find((p) => p.id === pid);
          if (!prereq) errors.push(`Prerequisite plan ${pid} not found.`);
          else if (prereq.status !== "finished") errors.push(`Prerequisite '${prereq.title}' is not finished.`);
        }
      }
      return { planId, valid: errors.length === 0, errors, warnings } as T;
    }
    case "plan_file_claims_set":
      return undefined as T;
    case "plan_file_claims_list":
      return [] as T;
    case "plan_coordination_event_publish": {
      const req = args.request as { sessionId: string; runId: string; planId: string; kind: string; payload?: string };
      return { id: `evt-${Date.now()}`, ...req, payload: req.payload ?? "{}", createdAt: Date.now() } as T;
    }
    case "plan_coordination_events":
      return [] as T;
    case "plan_set_launch_profile":
      return undefined as T;
    case "plan_get_launch_profile":
      return null as T;
    case "plan_merge_queue_list":
      return [] as T;
    case "plan_merge_queue_review":
      return { id: args.entryId as string, runId: "", planId: "", sessionId: "", status: args.decision as string, collisionReviewRequired: false, overlappingPlans: [], reviewedAt: Date.now(), createdAt: 0 } as T;
    case "plan_assign_with_profile": {
      const req = args.request as { planId: string; chatSessionId: string };
      const plan = s.plans.find((p) => p.id === req.planId);
      if (!plan) throw new Error(`Plan not found: ${req.planId}`);
      plan.status = "running";
      const run = { id: `run-${Date.now()}`, planId: req.planId, sessionId: plan.sessionId, chatSessionId: req.chatSessionId, workspacePath: undefined, status: "running", runnerKind: "native", error: undefined, stepsOutput: [], startedAt: Date.now(), finishedAt: undefined, createdAt: Date.now() };
      s.planRuns.push(run);
      return run as T;
    }
    case "list_files":
      return [] as T;
    case "read_file":
      return "E2E context file" as T;
    case "create_terminal": {
      const term = { id: s.nextTerminalId++, shell: String(args.shell), cwd: (args.cwd as string) ?? null, pid: 1234, rows: 24, cols: 80, startedAt: Math.floor(Date.now() / 1000), alive: true };
      s.terminals.push(term);
      return term as T;
    }
    case "list_terminals":
      return s.terminals as T;
    case "agent_start":
      return 1 as T;
    case "native_provider_catalog":
    case "native_provider_catalog_refresh": {
      // Build provider list dynamically — check credentials/blocked state
      // so disconnect/connect actually changes the UI.
      const baseProviders = [
        { id: "basebuild-local", label: "Basebuild Local", credentialOwner: "basebuild", localOnly: true, detail: "Local coordinator", authMethod: "local", apiKeyUrl: null, modelCount: 1, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "openai", label: "OpenAI", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://platform.openai.com/api-keys", modelCount: 1, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "umans", label: "Umans", credentialOwner: "user", localOnly: false, detail: "Connected", authMethod: "api_key", apiKeyUrl: "https://app.umans.ai/billing?context=personal&tab=api-keys", modelCount: 1, lastSyncedAt: 1_800_000_000, source: "provider_discovered", error: null },
        { id: "anthropic", label: "Anthropic", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://console.anthropic.com/settings/keys", modelCount: 1, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "devin", label: "Devin.ai", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://app.devin.ai/settings/api-keys", modelCount: 48, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "google", label: "Google Gemini", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://aistudio.google.com/apikey", modelCount: 33, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "groq", label: "Groq", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://console.groq.com/keys", modelCount: 18, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "openrouter", label: "OpenRouter", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://openrouter.ai/keys", modelCount: 19, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "deepseek", label: "DeepSeek", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://platform.deepseek.com/api_keys", modelCount: 2, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "mistral", label: "Mistral", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://console.mistral.ai/api-keys", modelCount: 29, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "xai", label: "xAI (Grok)", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://console.x.ai", modelCount: 29, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "together", label: "Together AI", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://api.together.ai/settings/api-keys", modelCount: 32, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "fireworks", label: "Fireworks AI", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://fireworks.ai/api-keys", modelCount: 22, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "cerebras", label: "Cerebras", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://cloud.cerebras.ai", modelCount: 7, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "custom", label: "Custom (OpenAI-compatible)", credentialOwner: "user", localOnly: false, detail: "Enter API key + base URL", authMethod: "api_key", apiKeyUrl: null, modelCount: 0, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
      ];
      const providers = baseProviders.map((p) => {
        if (p.localOnly) {
          return { ...p, status: "ready", configured: true };
        }
        const isBlocked = s.blockedProviders.has(p.id);
        const hasCred = s.credentials.has(p.id);
        const configured = hasCred && !isBlocked;
        return {
          ...p,
          status: configured ? "ready" : "setup_required",
          configured,
          detail: configured ? "Connected" : "Configure credentials",
        };
      });
      return {
        providers,
        models: [
          { id: "basebuild-local-coordinator", providerId: "basebuild-local", label: "Local Coordinator", supportsEffort: true, supportsStreaming: false, supportsTools: false, localOnly: true, contextWindow: null, maxTokens: null, supportsReasoning: true, supportedEfforts: ["low", "medium", "high", "xhigh"], supportsImages: false, source: "bundled" },
          { id: "gpt-5.1", providerId: "openai", label: "GPT-5.1", supportsEffort: true, supportsStreaming: true, supportsTools: true, localOnly: false, contextWindow: 400000, maxTokens: null, supportsReasoning: true, supportedEfforts: ["low", "medium", "high", "xhigh"], supportsImages: true, source: "bundled" },
          { id: "umans-glm-5.2", providerId: "umans", label: "Umans GLM 5.2", supportsEffort: true, supportsStreaming: true, supportsTools: true, localOnly: false, contextWindow: 128000, maxTokens: null, supportsReasoning: true, supportedEfforts: ["low", "medium", "high", "xhigh"], supportsImages: false, source: "provider_discovered" },
        ],
        effortLevels: [
          { id: "low", label: "Low", description: "Fast" },
          { id: "medium", label: "Medium", description: "Balanced" },
          { id: "high", label: "High", description: "Deep" },
          { id: "xhigh", label: "XHigh", description: "Max" },
        ],
        defaultProviderId: "basebuild-local",
        defaultModelId: "basebuild-local-coordinator",
        defaultEffortLevel: "medium",
        fetchedAt: 1_800_000_000,
        stale: false,
      } as T;
    }
    case "native_chat_start": {
      const req = args.request as { projectPath: string; title?: string; providerId?: string; modelId?: string; effortLevel?: string };
      const id = `nchat-${s.nextNativeChatId++}`;
      const ts = Math.floor(Date.now() / 1000);
      const session: NativeChatSession = {
        id,
        projectPath: req.projectPath,
        title: req.title ?? "Native Chat",
        profileId: "basebuild-native",
        providerId: req.providerId ?? "basebuild-local",
        modelId: req.modelId ?? "basebuild-local-coordinator",
        effortLevel: req.effortLevel ?? "medium",
        status: "ready",
        runState: "idle",
        createdAt: ts,
        updatedAt: ts,
      };
      s.nativeChatSessions.push(session);
      return session as T;
    }
    case "native_chat_get":
      return (s.nativeChatSessions.find((session) => session.id === args.sessionId) ?? null) as T;
    case "native_chat_list":
      return s.nativeChatSessions.filter((session) => session.projectPath === args.projectPath) as T;
    case "native_chat_messages":
      return s.nativeChatMessages.filter((message) => message.sessionId === args.sessionId) as T;
    case "native_chat_send": {
      const req = args.request as { sessionId: string; content: string; providerId?: string; modelId?: string; effortLevel?: string };
      const ts = Math.floor(Date.now() / 1000);
      const startedAt = Date.now();
      const userMessage: NativeChatMessage = {
        id: `nmsg-${s.nextNativeMessageId++}`,
        sessionId: req.sessionId,
        role: "user",
        content: req.content,
        sortOrder: s.nativeChatMessages.filter((m) => m.sessionId === req.sessionId).length,
        providerId: req.providerId ?? "basebuild-local",
        modelId: req.modelId ?? "basebuild-local-coordinator",
        effortLevel: req.effortLevel ?? "medium",
        createdAt: ts,
      };
      // Streaming trigger: emit phase + delta chunk events with real delays
      // before resolving, so e2e can assert the thinking indicator and
      // incremental markdown rendering (contract: native-chat://chunk with
      // { sessionId, delta, channel? } — channel "status" carries phases).
      const isStreamTest = req.content.includes("stream-test");
      const streamedContent = "Streaming **bold** and `code` arrived incrementally.";
      if (isStreamTest) {
        const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
        const chunk = (delta: string, channel?: string) =>
          __emit("native-chat://chunk", { sessionId: req.sessionId, delta, ...(channel ? { channel } : {}) });
        chunk("thinking", "status");
        await sleep(400);
        chunk("Considering the request…", "reasoning");
        await sleep(150);
        chunk("Streaming **bold**");
        await sleep(250);
        chunk(" and `code`");
        await sleep(250);
        chunk(" arrived incrementally.");
        await sleep(150);
      }
      const assistantContent = isStreamTest
        ? streamedContent
        : req.content.includes("Write one concise git commit message")
        ? "Let me write a concise commit message.\n\n1. `launch-sbox.sh` - changes\n2. `patch_engine.sh` - changes\n\n---\n\nRework patch system to target sbox-public"
        : req.content.includes("quick-reply-test")
        ? "Here are your options:\nA. Commit the changes\nB. Create a pull request\nC. Abort and revert\n"
        : req.content.includes("markdown-test")
        ? "Here is a **markdown** response with `inline code`.\n\n## Heading\n\n- Item one\n- Item two\n- Item three\n\n> A blockquote with wisdom.\n\n| Col A | Col B |\n|-------|-------|\n| 1 | 2 |\n| 3 | 4 |\n\n```ts\nconst x: string = \"hello\";\nconsole.log(x);\n```\n\n<script>alert(1)</script>\n\n[Example](https://example.com)"
        : req.content.includes("tool-card-test")
        ? "I'll write a file and run a command for you."
        : req.content.includes("schematic-wizard-deny-test")
        ? "I tried to write the schematic but the write was denied."
        : req.content.includes("schematic-wizard-test")
        ? "I'll ask you some questions and then write the schematic."
        : `Native harness echo: ${req.content}`;
      const assistantMessage: NativeChatMessage = {
        id: `nmsg-${s.nextNativeMessageId++}`,
        sessionId: req.sessionId,
        role: "assistant",
        content: assistantContent,
        sortOrder: userMessage.sortOrder + 1,
        providerId: req.providerId ?? "basebuild-local",
        modelId: req.modelId ?? "basebuild-local-coordinator",
        effortLevel: req.effortLevel ?? "medium",
        createdAt: ts,
      };
      s.nativeChatMessages.push(userMessage, assistantMessage);
      const completedAt = Date.now();
      const metric: NativeRequestMetric = {
        id: `nreq-${s.nextNativeMetricId++}`,
        sessionId: req.sessionId,
        providerId: req.providerId ?? "basebuild-local",
        modelId: req.modelId ?? "basebuild-local-coordinator",
        effortLevel: req.effortLevel ?? "medium",
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        ttftMs: 1,
        ttltMs: completedAt - startedAt,
        inputTokens: req.content.split(/\s+/).length,
        outputTokens: assistantContent.split(/\s+/).length,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        tokensPerSecond: 10,
        costTotal: 0,
        outcome: "success",
        errorClass: null,
        createdAt: ts,
      };
      s.nativeRequestMetrics.push(metric);
      const isToolCardTest = req.content.includes("tool-card-test");
      const isSchematicWizardTest = req.content.includes("schematic-wizard-test");
      const isSchematicDenyTest = req.content.includes("schematic-wizard-deny-test");
      const toolEvents: NativeToolEvent[] = isToolCardTest
        ? [
            {
              id: `ntool-write-${ts}`,
              sessionId: req.sessionId,
              messageId: assistantMessage.id,
              kind: "write_file",
              status: "success",
              summary: "Wrote 42 bytes to src/hello.ts",
              arguments: JSON.stringify({ path: "src/hello.ts", content: "console.log('hello');\n" }),
              diff: "+console.log('hello');\n",
              decision: "approved",
              ruleSource: null,
              sequence: 1,
              createdAt: ts,
            },
            {
              id: `ntool-edit-${ts}`,
              sessionId: req.sessionId,
              messageId: assistantMessage.id,
              kind: "edit_file",
              status: "success",
              summary: "Replaced 1 occurrence(s) in src/hello.ts",
              arguments: JSON.stringify({ path: "src/hello.ts", old_text: "hello", new_text: "world" }),
              diff: "-console.log('hello');\n+console.log('world');\n",
              decision: "approved",
              ruleSource: "edit_file:src/**",
              sequence: 2,
              createdAt: ts,
            },
            {
              id: `ntool-cmd-${ts}`,
              sessionId: req.sessionId,
              messageId: assistantMessage.id,
              kind: "run_command",
              status: "success",
              summary: "exit 0:\nhello world",
              arguments: JSON.stringify({ command: "node src/hello.ts" }),
              diff: null,
              decision: "approved",
              ruleSource: null,
              sequence: 3,
              createdAt: ts,
            },
          ]
        : isSchematicWizardTest
        ? [
            {
              id: `ntool-schematic-write-${ts}`,
              sessionId: req.sessionId,
              messageId: assistantMessage.id,
              kind: "write_file",
              status: "success",
              summary: "Wrote 128 bytes to .basebuild/project-schematic.md",
              arguments: JSON.stringify({ path: ".basebuild/project-schematic.md", content: "# Project Schematic\n\n## Goals\n- Build the thing\n" }),
              diff: "+# Project Schematic\n+\n+## Goals\n+- Build the thing\n",
              decision: "approved",
              ruleSource: "write_file:.basebuild/**",
              sequence: 1,
              createdAt: ts,
            },
          ]
        : isSchematicDenyTest
        ? [
            {
              id: `ntool-schematic-denied-${ts}`,
              sessionId: req.sessionId,
              messageId: assistantMessage.id,
              kind: "write_file",
              status: "denied",
              summary: "Write to .basebuild/project-schematic.md denied by user",
              arguments: JSON.stringify({ path: ".basebuild/project-schematic.md", content: "# Project Schematic\n" }),
              diff: null,
              decision: "denied",
              ruleSource: null,
              sequence: 1,
              createdAt: ts,
            },
          ]
        : [];
      if (isToolCardTest || isSchematicWizardTest || isSchematicDenyTest) {
        for (const te of toolEvents) s.nativeToolEvents.push(te);
      }
      return {
        userMessage,
        assistantMessage,
        metrics: metric,
        toolEvents,
        setupRequired: null,
        offline: (req.providerId ?? "basebuild-local") === "basebuild-local",
      } as T;
    }
    case "native_request_metrics":
      return s.nativeRequestMetrics.slice(-Math.min((args.limit as number) ?? 100, s.nativeRequestMetrics.length)) as T;
    case "native_request_metrics_summary": {
      const total = s.nativeRequestMetrics.length;
      const input = s.nativeRequestMetrics.reduce((acc, m) => acc + m.inputTokens, 0);
      const output = s.nativeRequestMetrics.reduce((acc, m) => acc + m.outputTokens, 0);
      return {
        totalRequests: total,
        totalInputTokens: input,
        totalOutputTokens: output,
        avgTokensPerSecond: total > 0 ? 10 : null,
        avgTtftMs: total > 0 ? 1 : null,
        avgTtltMs: total > 0 ? 5 : null,
        lastProviderId: total > 0 ? s.nativeRequestMetrics[total - 1].providerId : null,
        lastModelId: total > 0 ? s.nativeRequestMetrics[total - 1].modelId : null,
        lastEffortLevel: total > 0 ? s.nativeRequestMetrics[total - 1].effortLevel : null,
      } as T;
    }
    case "get_workspace_restore_state": {
      const projectPath = args.projectPath as string;
      const restoreDelayMs = globalState.__BASEBUILD_E2E_RESTORE_DELAY_MS__ ?? 0;
      if (restoreDelayMs > 0) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, restoreDelayMs);
        await promise;
      }
      return (s.workspaceRestoreByProject.get(projectPath) ?? {
        projectPath,
        lastSessionId: null,
        lastTabId: null,
        sideSection: "plans",
        sidebarCollapsed: false,
        sideCollapsed: false,
        sideWidth: 260,
        panelGrid: null,
        updatedAt: 0,
      }) as T;
    }
    case "save_workspace_restore_state":
      s.workspaceRestoreByProject.set((args.state as { projectPath: string }).projectPath, args.state);
      return args.state as T;
    case "native_save_provider_credential": {
      // Real wrapper sends an `{ input }` envelope — mirror the Rust contract.
      const req = args.input as { providerId: string; label: string; apiKey: string; baseUrl?: string | null };
      // Deterministic failure hook for e2e: a rejected key must keep the draft.
      if (req.apiKey === "invalid-key") {
        throw new Error("Invalid API key rejected by provider");
      }
      const baseUrl = req.baseUrl ?? null;
      s.credentials.set(req.providerId, { providerId: req.providerId, apiKey: req.apiKey, baseUrl, updatedAt: Math.floor(Date.now() / 1000) });
      s.blockedProviders.delete(req.providerId);
      return { providerId: req.providerId, label: req.label, apiKey: req.apiKey, baseUrl, updatedAt: Math.floor(Date.now() / 1000) } as T;
    }
    case "native_list_provider_credentials": {
      // Only return non-blocked credentials.
      return Array.from(s.credentials.values()).filter((c) => !s.blockedProviders.has(c.providerId)) as T;
    }
    case "native_delete_provider_credential": {
      const providerId = (args as { providerId?: string }).providerId ?? "unknown";
      s.blockedProviders.add(providerId);
      return undefined as T;
    }
    case "list_categories":
      return s.categories.filter((category) => category.sessionId === args.sessionId) as T;
    case "create_category": {
      const category: Category = { id: `cat-${s.nextCategoryId++}`, sessionId: args.sessionId as string, name: args.name as string, description: args.description as string, createdAt: Math.floor(Date.now() / 1000) };
      s.categories.push(category);
      return category as T;
    }
    case "delete_category":
      s.categories = s.categories.filter((category) => category.id !== args.id);
      return undefined as T;
    case "list_ideas":
      return s.ideas.filter((idea) => idea.sessionId === args.sessionId) as T;
    case "create_idea": {
      const ts = Math.floor(Date.now() / 1000);
      const idea: Idea = {
        id: `idea-${s.nextIdeaId++}`,
        sessionId: args.sessionId as string,
        categoryId: (args.categoryId as string | null) ?? null,
        title: args.title as string,
        description: args.description as string,
        status: "concept",
        createdAt: ts,
        updatedAt: ts,
      };
      s.ideas.push(idea);
      return idea as T;
    }
    case "update_idea_status": {
      const idea = s.ideas.find((item) => item.id === args.id);
      if (idea) idea.status = args.status as string;
      return undefined as T;
    }
    case "delete_idea":
      s.ideas = s.ideas.filter((idea) => idea.id !== args.id);
      return undefined as T;
    case "native_generate_ideas": {
      const req = args.request as { providerId?: string };
      const providerId = req.providerId ?? "basebuild-local";
      // Only configured, non-local providers generate ideas in the fixture.
      if (providerId === "basebuild-local" || providerId === "openai") {
        return {
          ideas: [],
          setupRequired: { providerId, providerLabel: providerId === "openai" ? "OpenAI" : "Basebuild Local", message: "Connect a model provider to generate ideas from this chat." },
          grounding: null,
        } as T;
      }
      return {
        ideas: [
          { title: "Improve onboarding", description: "Add a guided first-run tour." },
          { title: "Cache provider catalog", description: "Avoid refetching on every mount." },
        ],
        setupRequired: null,
        grounding: {
          schematicSections: ["Project Schematic", "Goals", "Vision"],
          finishedPlans: ["BB-0001", "BB-0002"],
          finishedPlanCount: 2,
          pickedCount: 1,
          rejectedCount: 0,
          digestEmpty: false,
        },
      } as T;
    }
    case "native_provider_login_start":
      return { providerId: args.providerId as string, providerLabel: "OpenAI", landingUrl: "http://127.0.0.1:0/", providerUrl: "https://example.com/keys" } as T;
    case "native_provider_login_poll":
      return { status: "success", message: null } as T;
    case "native_provider_login_cancel":
      return undefined as T;
    case "omp_status":
      return { installed: true, version: "omp 1.2.3", configPath: "C:\\basebuild-e2e\\.omp\\config.yml", message: null } as T;
    case "omp_debug_context":
      return { stats: null, usage: null, config: null } as T;
    case "native_chat_model_default":
      return {
        providerId: "basebuild-local",
        modelId: "basebuild-local-coordinator",
        effortLevel: "medium",
        source: "fallback",
        notice: null,
      } as T;
    case "native_chat_set_project_model_default":
    case "native_chat_set_global_model_default":
      return undefined as T;
    case "list_requirements":
      return [] as T;
    case "get_runtime_defaults":
      return { defaultChatProfileId: "basebuild-native", defaultTerminalProfileId: "default-terminal", defaultModel: "basebuild-local-coordinator", autoSendGeneratedPrompts: false, gitAiProviderId: null, gitAiModelId: null } as T;
    case "check_for_updates":
      return {
        available: true,
        version: "0.0.5",
        currentVersion: "0.0.4",
        notes: "E2E updater fixture",
        date: "2026-07-01T14:30:00Z",
        target: "windows-x86_64",
        downloadUrl: "https://github.com/basebuild-net/basebuild/releases/download/v0.0.5/Basebuild_0.0.5_x64-setup.exe",
      } as T;
    case "get_skipped_update_version":
      return null as T;
    case "clear_skipped_update":
    case "skip_update_version":
      return undefined as T;
    case "install_update":
      s.updateInstallCount += 1;
      return undefined as T;
    case "auth_status":
      return s.auth as T;
    case "auth_sign_out":
      s.auth = null;
      return undefined as T;
    case "auth_fetch_profile":
      if (!s.auth?.user) throw new Error("Not authenticated");
      return s.auth.user as T;
    case "auth_start_device_flow":
      return { deviceCode: "test-device", userCode: "ABCD-WXYZ", verificationUri: "https://basebuild.net/device", verificationUriComplete: "https://basebuild.net/device?code=ABCD-WXYZ", expiresIn: 900, interval: 5 } as T;
    case "auth_poll_device_flow": {
      const user = { id: "1", username: "TestUser", email: "test@basebuild.net", image: null, isAdmin: false, isEditor: false };
      s.auth = { accessToken: "test-token", expiresAt: "2026-12-31T00:00:00Z", scopes: ["mcp:usage", "profile:read"], user };
      return { status: "success", accessToken: "test-token", expiresAt: "2026-12-31T00:00:00Z", scopes: ["mcp:usage", "profile:read"], user } as T;
    }
    case "auth_get_token":
      return (s.auth?.accessToken ?? null) as T;
    case "open_url":
      return undefined as T;
    case "omp_telemetry_start":
    case "omp_telemetry_stop":
      return undefined as T;
    case "omp_telemetry_snapshot":
    case "omp_telemetry_refresh":
      return {
        attachment: { state: "attached" },
        provider: "anthropic",
        model: "claude-sonnet-4",
        planTier: "Claude Max",
        planSource: "local",
        effort: "high",
        sessionId: "sess-e2e",
        windows: [
          { window: "5h", usedFraction: 0.42, remainingFraction: 0.58, resetsAt: "2026-07-03T18:00:00Z", severity: "warning", measuredAt: Math.floor(Date.now() / 1000), ageMinutes: 1, isStale: false },
        ],
        recentMessages: [],
        assembledAt: Math.floor(Date.now() / 1000),
      } as T;
    case "usage_sync_trigger":
      return undefined as T;
    case "usage_sync_set_enabled":
      s.autoSyncEnabled = args.enabled as boolean;
      return undefined as T;
    case "get_approval_mode":
      return "balanced" as T;
    case "set_approval_mode":
      return undefined as T;
    case "list_approval_rules":
      return [] as T;
    case "add_approval_rule":
    case "remove_approval_rule":
      return undefined as T;
    case "usage_sync_status":
      return {
        enabled: s.autoSyncEnabled ?? true,
        gatesPass: !!s.auth,
        intervalMinutes: 60,
        lastSyncAt: s.auth ? Math.floor(Date.now() / 1000) - 120 : null,
        lastError: null,
      } as T;
    case "usage_sync_projected_usage":
      return {
        live: {
          rows: [
            { provider: "anthropic", window: "5h", usedFraction: 0.42, remainingFraction: 0.58, resetsAt: "2026-07-03T18:00:00Z", severity: "warning", fetchedAgoMin: 2, isStale: false },
            { provider: "anthropic", window: "7d", usedFraction: 0.18, remainingFraction: 0.82, resetsAt: "2026-07-10T00:00:00Z", severity: "ok", fetchedAgoMin: 2, isStale: false },
          ],
          shouldSync: false,
        },
        snapshot: {
          rows: [
            { provider: "anthropic", model: "claude-sonnet-4", requestsPerDay: 120, hoursPerDay: 2.5, costPerDay: 3.4, avgDurationMs: 2500, avgTtftMs: 800, errorRate: 0.01 },
          ],
        },
        plans: { plans: [] },
        timeline: { windows: [] },
        assembledAt: Math.floor(Date.now() / 1000),
      } as T;
    case "git_current_branch":
      return "main" as T;
    case "git_default_branch":
      return "main" as T;
    case "git_remote_url":
      return `https://github.com/basebuild-net/${(args.path as string)?.split(/[\\/]/).pop() ?? "repo"}.git` as T;
    case "git_branch_create":
      return undefined as T;
    case "git_branch_switch":
      return undefined as T;
    case "workspace_list":
      return [] as T;
    case "workspace_create":
      return { id: `ws-${Date.now()}`, projectPath: args.projectPath, planId: args.planId ?? null, branch: `bb/${args.referenceId}-${args.slug}`, path: `C:\\basebuild-e2e\\worktrees\\${args.referenceId}`, createdAt: Math.floor(Date.now() / 1000) } as T;
    case "workspace_remove":
      return undefined as T;
    case "workspace_is_supported":
      return true as T;
    case "pr_recommend":
      return { branch: args.branch, ahead: 2, behind: 0, changedFiles: 3, ghAvailable: false, ghAuthed: false, compareUrl: `https://github.com/basebuild/basebuild/compare/main...${args.branch}?expand=1` } as T;
    case "pr_create":
      return { success: true, url: `https://github.com/basebuild/basebuild/pull/1`, error: null, method: "browser" } as T;
    case "pr_gh_status":
      return [false, false] as T;
    case "get_run_concurrency_defaults":
      return { providers: { "basebuild-local": { maxConcurrency: 1, subagentsEnabled: false, subagentMaxCount: 0 } } } as T;
    case "set_run_concurrency_defaults":
      return undefined as T;
    case "get_run_concurrency_overrides":
      return { providers: {} } as T;
    case "set_run_concurrency_override":
      return undefined as T;
    case "notification_list":
      return s.notifications.slice().reverse().slice(0, (args.limit as number) ?? 100) as T;
    case "notification_unread_count":
      return s.notifications.filter((n) => !n.read).length as T;
    case "notification_mark_read": {
      const n = s.notifications.find((item) => item.id === args.id);
      if (n) n.read = true;
      return undefined as T;
    }
    case "notification_mark_all_read":
      s.notifications.forEach((n) => { n.read = true; });
      return undefined as T;
    case "notification_delete":
      s.notifications = s.notifications.filter((n) => n.id !== args.id);
      return undefined as T;
    case "notification_get_settings":
      return s.notificationSettings as T;
    case "notification_set_settings":
      s.notificationSettings = args.settings as { overrides: Record<string, string> };
      return undefined as T;
    case "effective_run_concurrency":
      return { maxConcurrency: 1, subagentsEnabled: false, subagentMaxCount: 0 } as T;
    case "integration_list":
      return [] as T;
    case "integration_cleanup":
      return undefined as T;
    case "get_milestone_auto_commit":
      return false as T;
    case "set_milestone_auto_commit":
      return undefined as T;
    case "list_resolved_skills":
      return [] as T;
    case "read_resolved_skill":
      return "" as T;
    case "provision_skill_dirs":
      return [] as T;
    case "omp_rpc_probe":
      return "omp 1.2.3" as T;
    case "omp_rpc_start":
    case "omp_rpc_send":
    case "omp_rpc_cancel":
    case "omp_rpc_shutdown":
    case "omp_rpc_resolve":
      return undefined as T;
    case "omp_rpc_status":
      return "none" as T;
    default:
      throw new Error(`Unhandled E2E Tauri command: ${command}`);
  }
}
