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
import type { ImplementationAssessment } from "../lib/planning-assessment";

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
  grounding?: string;
  anchor?: string | null;
  batchId?: string | null;
  assessment?: ImplementationAssessment;
  createdAt: number;
  updatedAt: number;
};

type IdeaRound = {
  id: string;
  sessionId: string;
  status: string;
  createdAt: number;
  completedAt: number | null;
  conceptCount: number;
  pickedCount: number;
  rejectedCount: number;
  archivedCount: number;
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
  changeName?: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
};

type LaunchProfile = {
  projectPath: string;
  engine: string;
  providerId: string;
  modelId: string;
  effortLevel?: string;
  skillId?: string;
  workerCount: number;
  workspacePolicy: string;
  schedulingMode: string;
  finishPolicy: string;
  updatedAt: number;
};

type MergeReviewEntry = {
  id: string;
  runId: string;
  planId: string;
  sessionId: string;
  status: "pending" | "approved" | "rejected" | "merged";
  collisionReviewRequired: boolean;
  overlappingPlans: string[];
  reviewedAt: number | null;
  createdAt: number;
};

/** Mirrors the Rust VoiceProfile wire shape (camelCase across the bridge). */
type MockVoiceProfile = {
  enabled: boolean;
  providerId: string;
  modelId: string;
  effortLevel: string;
  sttEngine: "openai_whisper" | "windows_native" | "local_whisper";
  sttProviderId: string;
  sttModelId: string;
  ttsEnabled: boolean;
  ttsVoice: string | null;
  ttsRate: number;
  mode: "push_to_talk" | "call";
  vadSilenceMs: number;
  bargeIn: boolean;
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
  /** Session ids with an in-flight native_chat_send, so native_chat_steer can answer honestly. */
  nativeChatRunning: string[];
  /** Voice preferences, mirroring the Rust VoiceProfile wire shape. */
  voiceProfile: MockVoiceProfile;
  nativeRequestMetrics: NativeRequestMetric[];
  categories: Category[];
  ideas: Idea[];
  nextCategoryId: number;
  nextIdeaId: number;
  ideaRounds: { id: string; sessionId: string; status: string; createdAt: number; completedAt: number | null }[];
  activeRoundBySession: Map<string, string>;
  nextRoundId: number;
  nextPlanningEventSeq?: number;
  taskProgressByChange?: Map<string, [number, number]>;
  archivedChanges?: Set<string>;
  launchProfile?: LaunchProfile;
  mergeQueue: MergeReviewEntry[];
  planQueue: { id: string; sessionId: string; planId: string; sortOrder: number; createdAt: number }[];
  planRuns: { id: string; planId: string; sessionId: string; chatSessionId?: string; status: string; runnerKind: string; error?: string; stepsOutput: unknown[]; startedAt?: number; finishedAt?: number; createdAt: number; finishOutcome?: unknown }[];
  planDependencies?: Map<string, { prerequisites: string[]; affectedPaths: string[]; schedulingMode: string; workspacePolicy: string }>;
  /** e2e knob: entry ids whose "merged" review throws (simulated merge conflict). */
  mergeReviewFailIds?: Set<string>;
  /** e2e knob: forces the finish policy applied at plan_run_complete to record this outcome error. */
  finishPolicyError?: string;
  /** e2e knob: idea ids that fail during batch_promote_ideas (per-idea isolation). */
  promoteFailIds?: Set<string>;
  workspaceRestoreByProject: Map<string, unknown>;
  recentProjects: { path: string; name: string; lastOpenedAt: number; lastActiveSessionId: string | null }[];
  pickProjectCalls: number;
  fixtureName: string | null;
  auth: { accessToken: string; expiresAt: string; scopes: string[]; user: { id: string; username: string; email: string; image: string | null; isAdmin: boolean; isEditor: boolean } | null } | null;
  updateInstallCount: number;
  autoSyncEnabled?: boolean;
  usageSyncRetried?: boolean;
  startupDesired?: boolean;
  startupPlatformSupported?: boolean;
  gitChangeStaged: boolean;
  terminals: { id: number; shell: string; cwd: string | null; pid: number; rows: number; cols: number; startedAt: number; alive: boolean }[];
  notifications: { id: string; kind: string; entityId: string; entityKind: string; projectPath: string; title: string; detail?: string; read: boolean; createdAt: number }[];
  credentials: Map<string, { providerId: string; apiKey: string; baseUrl: string | null; updatedAt: number }>;
  blockedProviders: Set<string>;
  providerAccounts: Map<string, { id: string; providerId: string; label: string; authMethod: string; health: string; cooldownUntil: number | null; lastError: string | null; lastUsedAt: number | null; createdAt: number; updatedAt: number }>;
  accountStrategy: string;
  notificationSettings: { overrides: Record<string, string> };
};

const globalState = globalThis as typeof globalThis & { __BASEBUILD_E2E_STATE__?: E2eState; __BASEBUILD_E2E_FIXTURE__?: string; __BASEBUILD_E2E_PICK_PROJECT_PATH__?: string; __BASEBUILD_E2E_PICKER_DELAY_MS__?: number; __BASEBUILD_E2E_RESTORE_DELAY_MS__?: number; __BASEBUILD_E2E_BOOTSTRAP_DELAY_MS__?: number; __BASEBUILD_E2E_INVOKE_DELAY_MS__?: number; __BASEBUILD_E2E_SLOW_COMMANDS__?: string[]; __BASEBUILD_E2E_TRANSCRIPT__?: string };


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
      id: "mvp-native-alpha",
      projectPath: "C:\\basebuild-e2e\\alpha",
      title: "Alpha onboarding",
      profileId: "basebuild-native",
      providerId: "umans",
      modelId: "umans-glm-5.2",
      effortLevel: "high",
      status: "ready",
      runState: "idle",
      createdAt: 1_800_000_000 - 300,
      updatedAt: 1_800_000_000 - 280,
    },
    {
      id: "mvp-native-bravo",
      projectPath: "C:\\basebuild-e2e\\bravo",
      title: "Bravo planning",
      profileId: "basebuild-native",
      providerId: "umans",
      modelId: "umans-glm-5.2",
      effortLevel: "high",
      status: "ready",
      runState: "idle",
      createdAt: 1_800_000_000 - 200,
      updatedAt: 1_800_000_000 - 180,
    },
    {
      id: "nchat_mvp-charlie",
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
      id: "mvp-msg-alpha-1",
      sessionId: "mvp-native-alpha",
      role: "user",
      content: "Hello alpha",
      sortOrder: 0,
      providerId: "umans",
      modelId: "umans-glm-5.2",
      effortLevel: "high",
      createdAt: 1_800_000_000 - 280,
    },
    {
      id: "mvp-msg-bravo-1",
      sessionId: "mvp-native-bravo",
      role: "user",
      content: "Hello bravo",
      sortOrder: 0,
      providerId: "umans",
      modelId: "umans-glm-5.2",
      effortLevel: "high",
      createdAt: 1_800_000_000 - 180,
    },
    {
      id: "mvp-msg-user",
      sessionId: "nchat_mvp-charlie",
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
    panelGrid: panelGridFor("mvp-panel-charlie", "nchat_mvp-charlie"),
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
      nativeChatRunning: [],
      voiceProfile: {
        enabled: false,
        providerId: "",
        modelId: "",
        effortLevel: "medium",
        sttEngine: "openai_whisper",
        sttProviderId: "openai",
        sttModelId: "whisper-1",
        ttsEnabled: true,
        ttsVoice: null,
        ttsRate: 1,
        mode: "call",
        vadSilenceMs: 900,
        bargeIn: true,
      },
      nativeRequestMetrics: [],
      nativeToolEvents: [],
      categories: [],
      ideas: [],
      nextCategoryId: 1,
      nextIdeaId: 1,
      ideaRounds: [],
      activeRoundBySession: new Map(),
      nextRoundId: 1,
      planQueue: [],
      mergeQueue: [],
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
      providerAccounts: new Map([
        ["umans_acct1", { id: "umans_acct1", providerId: "umans", label: "Umans key …test", authMethod: "api", health: "healthy", cooldownUntil: null, lastError: null, lastUsedAt: Date.now() - 3600_000, createdAt: 1_800_000_000, updatedAt: 1_800_000_000 }],
      ]),
      accountStrategy: "round_robin",
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
    changeName: input.changeName ?? null,
    createdAt: ts,
    updatedAt: ts,
    finishedAt: null,
  };
}

function reconcileMockPlanRunOwners(
  s: E2eState,
  runs: E2eState["planRuns"],
): E2eState["planRuns"] {
  for (const run of runs) {
    if (run.status !== "running" || run.runnerKind !== "native") continue;
    const chat = s.nativeChatSessions.find((candidate) => candidate.id === run.chatSessionId);
    if (chat?.runState === "running" || chat?.runState === "needs_input") continue;
    run.status = "awaiting_review";
    run.error = "Linked chat is not executing; continuation required";
    run.finishedAt = Math.floor(Date.now() / 1000);
    const plan = s.plans.find((candidate) => candidate.id === run.planId);
    if (plan) plan.status = "ready";
  }
  return runs;
}

export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  // Loading states are only observable if the backend is slow. Tests set
  // `__BASEBUILD_E2E_INVOKE_DELAY_MS__` (all commands) or scope it to a few
  // via `__BASEBUILD_E2E_SLOW_COMMANDS__`, then assert the skeleton renders
  // before the data does.
  const slowOnly = globalState.__BASEBUILD_E2E_SLOW_COMMANDS__;
  const invokeDelayMs = globalState.__BASEBUILD_E2E_INVOKE_DELAY_MS__ ?? 0;
  if (invokeDelayMs > 0 && (!slowOnly || slowOnly.includes(command))) {
    await new Promise<void>((resolve) => setTimeout(resolve, invokeDelayMs));
  }
  const s = state();

  switch (command) {
    case "list_recent_projects":
      return [...s.recentProjects].sort((a, b) => a.name.localeCompare(b.name)).slice(0, Number(args.limit ?? 10)) as T;
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
      if (existing) {
        existing.name = name;
        existing.lastOpenedAt = Math.floor(Date.now() / 1000);
      } else {
        s.recentProjects.push({ path, name, lastOpenedAt: Math.floor(Date.now() / 1000), lastActiveSessionId: null });
      }
      return s.recentProjects.find((project) => project.path === path) as T;
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
      // Do NOT reorder the list - matching the Rust backend's INSERT OR IGNORE
      // which only inserts if missing, never bumps last_opened_at for existing rows.
      const existing = s.recentProjects.find((project) => project.path === path);
      if (!existing) {
        const name = path.split("\\").pop() || "project";
        s.recentProjects.push({ path, name, lastOpenedAt: Math.floor(Date.now() / 1000), lastActiveSessionId: null });
      }
      const result = s.recentProjects.find((project) => project.path === path) ?? null;
      return result as T;
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
    case "native_interaction_save_draft": {
      const w = globalThis as unknown as { __basebuildMockInteraction?: { [k: string]: unknown } };
      const request = args.request as { answers?: unknown; currentPage?: number } | undefined;
      if (w.__basebuildMockInteraction && request) {
        w.__basebuildMockInteraction.draftAnswers = request.answers ?? [];
        w.__basebuildMockInteraction.currentPage = request.currentPage ?? 0;
      }
      return w.__basebuildMockInteraction as T;
    }
    case "native_interaction_resolve": {
      const w = globalThis as unknown as { __basebuildMockInteraction?: { id: string; status: string; [k: string]: unknown } };
      const request = args.request as { answers?: unknown } | undefined;
      if (w.__basebuildMockInteraction) {
        w.__basebuildMockInteraction.status = "answered";
        w.__basebuildMockInteraction.answers = request?.answers ?? [];
      }
      return (w.__basebuildMockInteraction ?? { id: args.id as string, status: "answered", answers: request?.answers ?? [] }) as T;
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
    case "restart_app":
      return undefined as T;
    case "stability_record_renderer_crash": {
      const g = globalThis as typeof globalThis & { __BASEBUILD_RENDERER_CRASHES__?: unknown[] };
      (g.__BASEBUILD_RENDERER_CRASHES__ ??= []).push(args);
      return undefined as T;
    }
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
    case "update_tab_title": {
      const tab = s.tabs.find((item) => item.id === args.id);
      if (tab) tab.title = args.title as string;
      return undefined as T;
    }
    case "native_chat_rename": {
      const session = s.nativeChatSessions.find((item) => item.id === args.sessionId);
      if (session) session.title = args.title as string;
      return undefined as T;
    }
    case "has_project_schematic":
      return true as T;
    case "get_project_schematic":
      return { content: s.fixtureName === "mvp-baseline" ? MVP_FIXTURE_SCHEMATIC : "# Project Schematic: E2E Fixture\n\n## Purpose\nExercise plan context generation." } as T;
    case "list_plans":
      return s.plans.filter((plan) => plan.sessionId === args.sessionId) as T;
    case "list_project_plans":
      return (args.projectPath === s.projectPath ? s.plans : []) as T;
    case "planning_integrity_check": {
      // Self-consistent with the fixture state: report plans whose source
      // idea no longer exists, matching the backend check's primary case.
      const ideaIds = new Set(s.ideas.map((idea) => idea.id));
      return s.plans
        .filter((plan) => {
          const ideaId = (plan as { ideaId?: string | null }).ideaId;
          return typeof ideaId === "string" && ideaId.length > 0 && !ideaIds.has(ideaId);
        })
        .map((plan) => ({
          kind: "plan_missing_idea",
          entityId: plan.id,
          title: plan.title,
          detail: `Plan '${plan.title}' references a source idea that no longer exists.`,
        })) as T;
    }
    case "create_plan": {
      const input = args.input as { sessionId: string; title: string; description: string };
      const plan = makePlan(input.sessionId, input);
      s.plans.push(plan);
      return plan as T;
    }
    case "batch_promote_ideas": {
      const sessionId = args.sessionId as string;
      const ideaIds = args.ideaIds as string[];
      const created: Plan[] = [];
      const errors: { ideaId: string; error: string }[] = [];
      for (const ideaId of ideaIds) {
        const idea = s.ideas.find((i) => i.id === ideaId);
        if (!idea) {
          errors.push({ ideaId, error: "Idea not found" });
          continue;
        }
        if (s.promoteFailIds?.has(ideaId)) {
          errors.push({ ideaId, error: "promotion failed (e2e)" });
          continue;
        }
        const plan = makePlan(sessionId, { title: idea.title, description: idea.description });
        s.plans.push(plan);
        idea.status = "picked";
        created.push(plan);
        s.nextPlanningEventSeq = (s.nextPlanningEventSeq ?? 0) + 1;
        __emit("planning://event", {
          kind: "plan_created",
          entityId: plan.id,
          projectPath: s.projectPath,
          sessionId,
          title: plan.title,
          seq: s.nextPlanningEventSeq,
          ts: Math.floor(Date.now() / 1000),
        });
      }
      return { created, errors } as T;
    }
    case "update_plan": {
      const plan = s.plans.find((item) => item.id === args.id);
      if (!plan) throw new Error(`Plan not found: ${String(args.id)}`);
      Object.assign(plan, args.input as Partial<Plan>, { updatedAt: Math.floor(Date.now() / 1000) });
      return plan as T;
    }
    case "set_plan_status": {
      const plan = s.plans.find((item) => item.id === args.id);
      if (!plan) throw new Error(`Plan not found: ${String(args.id)}`);
      plan.status = args.status as Plan["status"];
      if (plan.status === "openspec" && !plan.changeName) {
        plan.changeName = plan.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      }
      plan.updatedAt = Math.floor(Date.now() / 1000);
      return plan as T;
    }
    case "set_plan_context": {
      const plan = s.plans.find((item) => item.id === args.id);
      if (!plan) throw new Error(`Plan not found: ${String(args.id)}`);
      plan.context = args.context as Plan["context"];
      plan.updatedAt = Math.floor(Date.now() / 1000);
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
      const plan = s.plans.find((p) => p.id === planId);
      const nowSecs = Math.floor(Date.now() / 1000);
      const run = { id: `run-${Date.now()}`, planId, sessionId: typeof args.sessionId === "string" && args.sessionId ? args.sessionId : (plan?.sessionId ?? ""), chatSessionId, workspacePath: `worktrees/bb-${planId}`, status: "running", runnerKind: "native", error: undefined, stepsOutput: [], startedAt: nowSecs, finishedAt: undefined, createdAt: Date.now() };
      s.planRuns.push(run);
      if (plan) plan.status = "running";
      const chat = s.nativeChatSessions.find((candidate) => candidate.id === chatSessionId);
      if (chat) chat.runState = "running";
      return run as T;
    }
    case "openspec_list_changes": {
      const entries = new Map<string, {
        name: string;
        hasProposal: boolean;
        hasDesign: boolean;
        hasTasks: boolean;
        hasSpecs: boolean;
        completed: number;
        total: number;
        linkedPlanReferenceId?: string;
        archived: boolean;
        createdAt: number;
      }>();
      for (const plan of s.plans) {
        if (!plan.changeName) continue;
        const [completed, total] = s.taskProgressByChange?.get(plan.changeName) ?? [0, 0];
        entries.set(plan.changeName, {
          name: plan.changeName,
          hasProposal: true,
          hasDesign: true,
          hasTasks: total > 0,
          hasSpecs: true,
          completed,
          total,
          linkedPlanReferenceId: plan.referenceId,
          archived: s.archivedChanges?.has(plan.changeName) ?? false,
          createdAt: plan.createdAt,
        });
      }
      return [...entries.values()] as T;
    }
    case "openspec_parse_tasks_structured":
      return { phases: [], total: 0, completed: 0 } as T;
    case "openspec_read_tasks_structured":
      return { phases: [], total: 0, completed: 0 } as T;
    case "openspec_toggle_task":
      return undefined as T;
    case "openspec_archive_change": {
      const archived = (s.archivedChanges ??= new Set<string>());
      archived.add(args.changeName as string);
      return undefined as T;
    }
    case "openspec_link_change_to_plan":
      return undefined as T;
    case "openspec_unlink_plan_from_change":
      return undefined as T;
    case "openspec_refresh_task_progress":
      return false as T;
    case "openspec_task_progress": {
      // Tests drive progress via the __e2e_set_task_progress command
      // (change name → [completed, total]); default 0/0.
      const knobs = (s.taskProgressByChange ??= new Map<string, [number, number]>());
      const progress = knobs.get(args.changeName as string) ?? [0, 0];
      return progress as T;
    }
    case "__e2e_set_task_progress": {
      const knobs = (s.taskProgressByChange ??= new Map<string, [number, number]>());
      knobs.set(args.changeName as string, [args.completed as number, args.total as number]);
      return undefined as T;
    }
    case "plan_run_pause":
      return undefined as T;
    case "plan_run_cancel": {
      const run = s.planRuns.find((candidate) => candidate.id === args.runId);
      if (run) {
        run.status = "cancelled";
        run.finishedAt = Math.floor(Date.now() / 1000);
        const plan = s.plans.find((candidate) => candidate.id === run.planId);
        if (plan && !args.cancelPlan) plan.status = "ready";
      }
      return undefined as T;
    }
    case "plan_run_complete": {
      const runId = args.runId as string;
      const run = s.planRuns.find((r) => r.id === runId);
      const plan = run ? s.plans.find((candidate) => candidate.id === run.planId) : undefined;
      const progress = plan?.changeName
        ? (s.taskProgressByChange?.get(plan.changeName) ?? [0, 0])
        : null;
      const checklistComplete = progress === null || (progress[1] > 0 && progress[0] === progress[1]);
      if (run) {
        if (args.succeeded && !checklistComplete) {
          run.status = "awaiting_review";
          run.error = progress?.[1] === 0
            ? "Checklist has no required tasks; review required"
            : `Checklist incomplete: ${progress?.[0]}/${progress?.[1]} tasks complete`;
          if (plan) plan.status = "ready";
          return undefined as T;
        }
        run.status = args.succeeded ? "succeeded" : "failed";
        run.finishedAt = Math.floor(Date.now() / 1000);
        if (plan) plan.status = args.succeeded ? "finished" : "ready";
        // Mirror the backend: the finish policy is applied EXACTLY ONCE at
        // completion and its outcome persisted on the run. Reads via
        // plan_run_finish_outcome never re-apply.
        if (args.succeeded) {
          const policy = s.launchProfile?.finishPolicy ?? "hold";
          if (policy === "hold") {
            run.finishOutcome = { kind: "hold" };
          } else if (s.finishPolicyError) {
            run.finishOutcome = {
              kind: "applied",
              outcome: { runId, policy, commitSha: null, prUrl: null, mergeReady: false, error: s.finishPolicyError },
            };
          } else {
            if (policy === "queue_merge_review") {
              s.mergeQueue.push({
                id: `mq-${Date.now()}`, runId: run.id, planId: run.planId, sessionId: run.sessionId,
                status: "pending", collisionReviewRequired: false, overlappingPlans: [],
                reviewedAt: null, createdAt: Date.now(),
              });
              __emit("planning://event", {
                kind: "integration_action", entityId: run.id, projectPath: s.projectPath,
                sessionId: run.sessionId, title: "Queued for merge review",
                seq: (s.nextPlanningEventSeq ?? 0) + 1, ts: Math.floor(Date.now() / 1000),
              });
              s.nextPlanningEventSeq = (s.nextPlanningEventSeq ?? 0) + 1;
            }
            run.finishOutcome = {
              kind: "applied",
              outcome: {
                runId, policy,
                commitSha: "abc123def456",
                prUrl: policy === "auto_commit_pr" ? "https://example.com/pr/1" : null,
                mergeReady: policy === "queue_merge_review",
                error: null,
              },
            };
          }
        }
      }
      return undefined as T;
    }
    case "plan_run_mark_complete": {
      const run = s.planRuns.find((candidate) => candidate.id === args.runId);
      if (!run) throw new Error("Run not found");
      const plan = s.plans.find((candidate) => candidate.id === run.planId);
      const progress = plan?.changeName
        ? (s.taskProgressByChange?.get(plan.changeName) ?? [0, 0])
        : null;
      if (progress && progress[1] === 0) {
        throw new Error("Cannot mark complete: the linked OpenSpec change has no required tasks.");
      }
      if (progress && progress[0] < progress[1]) {
        throw new Error(`Cannot mark complete: ${progress[0]}/${progress[1]} required OpenSpec tasks are complete.`);
      }
      run.status = "succeeded";
      run.error = undefined;
      run.finishedAt = Math.floor(Date.now() / 1000);
      if (plan) plan.status = "finished";
      return undefined as T;
    }
    case "plan_run_finish_outcome": {
      const run = s.planRuns.find((r) => r.id === args.runId);
      return (run?.finishOutcome ?? { kind: "hold" }) as T;
    }
    case "plan_run_check_completion":
      return [0, 0] as T;
    case "pipeline_list_runs":
      return [] as T;
    case "pipeline_get_run":
      return null as T;
    case "pipeline_cancel":
      return undefined as T;
    case "plan_run_list": {
      return reconcileMockPlanRunOwners(
        s,
        s.planRuns.filter((run) => run.sessionId === args.sessionId),
      ) as T;
    }
    case "plan_run_list_by_project": {
      const projectPath = args.projectPath as string;
      const sessionIds = new Set([
        ...s.sessions.filter((session) => session.projectPath === projectPath).map((session) => session.id),
        ...s.nativeChatSessions.filter((chat) => chat.projectPath === projectPath).map((chat) => chat.id),
      ]);
      return reconcileMockPlanRunOwners(
        s,
        s.planRuns.filter((run) => sessionIds.has(run.sessionId)),
      ) as T;
    }
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
        const readiness = p.status === "finished" ? "finished" : p.status === "cancelled" ? "cancelled" : unmet.length > 0 ? "blocked" : (schedulingMode !== "yolo" && runningCollisions.length > 0) ? "blocked" : p.status === "running" ? "running" : "ready";
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
    case "plan_merge_queue_list":
      return s.mergeQueue.filter((e) => e.sessionId === args.sessionId) as T;
    case "plan_merge_queue_review": {
      const entryId = args.entryId as string;
      const decision = args.decision as string;
      if (decision === "merged" && s.mergeReviewFailIds?.has(entryId)) {
        throw new Error(`merge conflict in ${entryId}: overlapping hunks in src/app.ts`);
      }
      const entry = s.mergeQueue.find((e) => e.id === entryId);
      if (entry) {
        entry.status = decision as MergeReviewEntry["status"];
        entry.reviewedAt = Date.now();
      }
      return (entry ?? { id: entryId, runId: "", planId: "", sessionId: "", status: decision as MergeReviewEntry["status"], collisionReviewRequired: false, overlappingPlans: [], reviewedAt: Date.now(), createdAt: 0 }) as T;
    }
    case "__e2e_fail_merge_review":
      s.mergeReviewFailIds = new Set(args.entryIds as string[]);
      return undefined as T;
    case "__e2e_set_finish_policy_error":
      s.finishPolicyError = args.error as string;
      return undefined as T;
    case "__e2e_fail_promote_ideas":
      s.promoteFailIds = new Set(args.ideaIds as string[]);
      return undefined as T;
    case "__e2e_seed_merge_queue": {
      const entries = args.entries as MergeReviewEntry[];
      s.mergeQueue = entries;
      return undefined as T;
    }
    case "plan_coordination_events":
      return [] as T;
    case "plan_set_launch_profile": {
      const profile = args.profile as LaunchProfile;
      s.launchProfile = profile;
      return undefined as T;
    }
    case "plan_get_launch_profile":
      return (s.launchProfile ?? null) as T;
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
    case "native_chat_bootstrap": {
      const delayMs = globalState.__BASEBUILD_E2E_BOOTSTRAP_DELAY_MS__ ?? 0;
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
      const catalog = await invoke<Record<string, unknown>>("native_provider_catalog");
      const resolved = await invoke<Record<string, unknown>>("native_chat_model_default", {
        projectPath: args.projectPath,
      });
      return { catalog, resolved } as T;
    }
    case "native_catalog_sync":
      return { synced: 4, skipped: 0, error: null } as T;
    case "native_provider_popularity":
      return { providers: {}, models: {}, error: null } as T;
    case "execution_advice_get": {
      const roleAdvice = (role: "planner" | "coder") => ({
        role,
        recommendation: {
          providerId: "umans",
          modelId: "umans-glm-5.2",
          label: "Umans GLM 5.2",
          score: role === "planner" ? 84.2 : 88.6,
          confidence: "medium",
          factors: [
            { name: "quality_fit", score: 35, maxScore: 45, explanation: "Public role-fit evidence scores 78%" },
            { name: "capacity", score: 11, maxScore: 15, explanation: "Local telemetry reports 73% remaining" },
          ],
          reasons: [],
          sourceFreshness: ["public_profile_age_seconds:3600", "capacity:omp_live:fresh"],
          userOverride: false,
        },
        alternatives: [{
          providerId: "openai",
          modelId: "gpt-5.1",
          label: "GPT-5.1",
          score: 80.1,
          confidence: "medium",
          factors: [],
          reasons: [],
          sourceFreshness: ["public_profile_age_seconds:3600", "capacity:missing"],
          userOverride: false,
        }],
        excluded: [],
        confidence: "medium",
        generatedAt: Math.floor(Date.now() / 1000),
      });
      return {
        schemaVersion: 1,
        assessmentSource: "idea_assessment",
        difficultyBucket: 4,
        effortBucket: "same_day",
        assessmentStale: false,
        planner: roleAdvice("planner"),
        coder: roleAdvice("coder"),
      } as T;
    }
    case "execution_advice_set_override":
    case "execution_advice_clear_override":
      return undefined as T;
    case "execution_advice_feedback_consent":
      return { enabled: false, updatedAt: null } as T;
    case "execution_advice_set_feedback_consent": {
      const input = args.input;
      const enabled = Boolean(
        input && typeof input === "object" && "enabled" in input && input.enabled,
      );
      return { enabled, updatedAt: Math.floor(Date.now() / 1000) } as T;
    }
    case "execution_advice_list_feedback":
      return [] as T;
    case "execution_advice_export_feedback":
      return "[]" as T;
    case "execution_advice_delete_feedback":
      return 0 as T;
    case "execution_advice_record_feedback":
      return {
        id: `advisor-feedback-${Date.now()}`,
        schemaVersion: 1,
        role: "planner",
        recommendedProviderId: "umans",
        recommendedModelId: "umans-glm-5.2",
        selectedProviderId: "umans",
        selectedModelId: "umans-glm-5.2",
        outcome: "accepted",
        confidence: "medium",
        difficultyBucket: 4,
        effortBucket: "same_day",
        createdAt: Math.floor(Date.now() / 1000),
      } as T;
    case "__e2e_seed_omp_credential": {
      const providerId = String(args.providerId ?? "");
      if (!providerId) throw new Error("providerId is required");
      s.credentials.set(providerId, {
        providerId,
        apiKey: "omp-import-test",
        baseUrl: `omp://${providerId}`,
        updatedAt: Math.floor(Date.now() / 1000),
      });
      s.blockedProviders.delete(providerId);
      return null as T;
    }
    case "native_provider_login_start": {
      const providerId = String(args.providerId ?? "");
      if (!providerId) throw new Error("providerId is required");
      return {
        providerId,
        status: "waiting_browser",
        message: "Complete sign-in in your browser.",
        prompt: null,
        complete: false,
        error: null,
      } as T;
    }
    case "native_provider_login_poll": {
      const providerId = String(args.providerId ?? "");
      if (!providerId) throw new Error("providerId is required");
      s.credentials.set(providerId, {
        providerId,
        apiKey: "oauth-test-token",
        baseUrl: providerId === "openai-codex" ? "native://openai-codex" : `omp://${providerId}`,
        updatedAt: Math.floor(Date.now() / 1000),
      });
      s.blockedProviders.delete(providerId);
      return {
        providerId,
        status: "complete",
        message: "Provider connected.",
        prompt: null,
        complete: true,
        error: null,
      } as T;
    }
    case "native_provider_login_submit": {
      const providerId = String(args.providerId ?? "");
      return {
        providerId,
        status: "waiting",
        message: "Completing sign-in.",
        prompt: null,
        complete: false,
        error: null,
      } as T;
    }
    case "native_provider_login_cancel": {
      const providerId = String(args.providerId ?? "");
      if (!providerId) throw new Error("providerId is required");
      return {
        providerId,
        status: "cancelled",
        message: "Provider sign-in cancelled.",
        prompt: null,
        complete: false,
        error: null,
      } as T;
    }
    case "native_provider_catalog":
    case "native_provider_catalog_refresh":
    case "native_provider_refresh_omp_credentials": {
      // Build provider list dynamically — check credentials/blocked state
      // so disconnect/connect actually changes the UI.
      const baseProviders = [
        { id: "basebuild-local", label: "None", credentialOwner: "basebuild", localOnly: true, detail: "No provider connected — select a provider to chat.", authMethod: "local", apiKeyUrl: null, modelCount: 1, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "openai-codex", label: "OpenAI Codex", credentialOwner: "user", localOnly: false, detail: "Sign in with a ChatGPT subscription through Basebuild's native OpenAI OAuth flow.", authMethod: "oauth", apiKeyUrl: null, modelCount: 1, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "openai", label: "OpenAI API", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://platform.openai.com/api-keys", modelCount: 2, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "umans", label: "Umans", credentialOwner: "user", localOnly: false, detail: "Connected", authMethod: "api_key", apiKeyUrl: "https://app.umans.ai/billing?context=personal&tab=api-keys", modelCount: 1, lastSyncedAt: 1_800_000_000, source: "provider_discovered", error: null },
        { id: "anthropic", label: "Anthropic", credentialOwner: "user", localOnly: false, detail: "Sign in with a Claude subscription through Oh My Pi, or connect with an API key.", authMethod: "oauth", apiKeyUrl: "https://console.anthropic.com/settings/keys", modelCount: 1, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "devin", label: "Devin.ai", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://app.devin.ai/settings/api-keys", modelCount: 48, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "google", label: "Google Gemini", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://aistudio.google.com/apikey", modelCount: 33, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "groq", label: "Groq", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://console.groq.com/keys", modelCount: 18, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "openrouter", label: "OpenRouter", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://openrouter.ai/keys", modelCount: 19, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "deepseek", label: "DeepSeek", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://platform.deepseek.com/api_keys", modelCount: 2, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "mistral", label: "Mistral", credentialOwner: "user", localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://console.mistral.ai/api-keys", modelCount: 29, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
        { id: "xai", label: "xAI (Grok)", credentialOwner: "user", localOnly: false, detail: "Sign in with your xAI account through Oh My Pi, or connect with an API key.", authMethod: "oauth", apiKeyUrl: "https://console.x.ai", modelCount: 29, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
      ];
      const providers = baseProviders.map((p) => {
        if (p.localOnly) {
          return { ...p, status: "ready", configured: true, connectedVia: null, accountCount: 0, oauthCount: 0, apiKeyCount: 0, aggregateHealth: "healthy" };
        }
        const isBlocked = s.blockedProviders.has(p.id);
        const cred = s.credentials.get(p.id);
        const configured = Boolean(cred) && !isBlocked;
        const connectedVia = !configured || !cred
          ? null
          : cred.baseUrl === "native://openai-codex"
            ? "oauth"
            : cred.baseUrl?.startsWith("omp://")
              ? "omp"
              : "api";
        const providerAccountRows = Array.from(s.providerAccounts.values()).filter((a) => a.providerId === p.id);
        const accountCount = providerAccountRows.length;
        const oauthCount = providerAccountRows.filter((a) => a.authMethod === "oauth").length;
        const apiKeyCount = providerAccountRows.filter((a) => a.authMethod === "api").length;
        const aggregateHealth = accountCount === 0
          ? "healthy"
          : providerAccountRows.every((a) => a.health === "healthy") ? "healthy"
            : providerAccountRows.some((a) => a.health === "error" || a.health === "auth_expired") ? "broken"
            : "degraded";
        return {
          ...p,
          status: configured ? "ready" : "setup_required",
          configured,
          connectedVia,
          detail: configured ? "Connected" : "Configure credentials",
          accountCount,
          oauthCount,
          apiKeyCount,
          aggregateHealth,
        };
      });
      return {
        providers,
        models: [
          { id: "basebuild-local-coordinator", providerId: "basebuild-local", label: "None", supportsEffort: true, supportsStreaming: false, supportsTools: false, localOnly: true, contextWindow: null, maxTokens: null, supportsReasoning: true, supportedEfforts: ["low", "medium", "high", "xhigh"], supportsImages: false, source: "bundled", supportsAudioInput: false, supportsAudioOutput: false, voice: null },
          // The ChatGPT subscription route carries no audio or realtime scope,
          // so its models are text-only. Filtering this provider to voice is
          // the empty state that tells the user to pick another provider.
          { id: "gpt-5.5", providerId: "openai-codex", label: "GPT-5.5 Codex", supportsEffort: true, supportsStreaming: true, supportsTools: false, localOnly: false, contextWindow: 400000, maxTokens: null, supportsReasoning: true, supportedEfforts: ["low", "medium", "high", "xhigh"], supportsImages: true, source: "bundled", supportsAudioInput: false, supportsAudioOutput: false, voice: null },
          { id: "gpt-5.1", providerId: "openai", label: "GPT-5.1", supportsEffort: true, supportsStreaming: true, supportsTools: true, localOnly: false, contextWindow: 400000, maxTokens: null, supportsReasoning: true, supportedEfforts: ["low", "medium", "high", "xhigh"], supportsImages: true, source: "bundled", supportsAudioInput: false, supportsAudioOutput: false, voice: null },
          { id: "gpt-realtime-2.1", providerId: "openai", label: "GPT Realtime 2.1", supportsEffort: false, supportsStreaming: true, supportsTools: true, localOnly: false, contextWindow: 32000, maxTokens: 4096, supportsReasoning: false, supportedEfforts: [], supportsImages: true, source: "bundled", supportsAudioInput: true, supportsAudioOutput: true, voice: { level: "realtime", billing: "api_key", transports: ["webrtc", "websocket", "sip"], turnDetection: ["server_vad", "semantic_vad", "none"], bargeIn: true, voices: ["alloy", "cedar", "marin"], sampleRateIn: 24000, sampleRateOut: 24000 } },
          { id: "umans-glm-5.2", providerId: "umans", label: "Umans GLM 5.2", supportsEffort: true, supportsStreaming: true, supportsTools: true, localOnly: false, contextWindow: 128000, maxTokens: null, supportsReasoning: true, supportedEfforts: ["low", "medium", "high", "xhigh"], supportsImages: false, source: "provider_discovered", supportsAudioInput: false, supportsAudioOutput: false, voice: null },
          { id: "umans-lite-1.0", providerId: "umans", label: "Umans Lite 1.0", supportsEffort: true, supportsStreaming: true, supportsTools: false, localOnly: false, contextWindow: 32000, maxTokens: null, supportsReasoning: false, supportedEfforts: ["low", "medium"], supportsImages: false, source: "provider_discovered", supportsAudioInput: false, supportsAudioOutput: false, voice: null },
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
      const id = `nchat_${s.nextNativeChatId++}`;
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
    case "native_chat_history": {
      const limit = (args.limit as number | null) ?? undefined;
      const entries = s.nativeChatSessions
        .map((session) => ({
          ...session,
          messageCount: s.nativeChatMessages.filter((m) => m.sessionId === session.id).length,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return (limit ? entries.slice(0, limit) : entries) as T;
    }
    case "native_chat_messages":
      return s.nativeChatMessages.filter((message) => message.sessionId === args.sessionId) as T;
    case "voice_profile_get":
      return s.voiceProfile as T;
    case "voice_profile_set": {
      const next = args.profile as MockVoiceProfile | undefined;
      if (!next) throw new Error("Voice profile is required.");
      s.voiceProfile = { ...s.voiceProfile, ...next };
      return s.voiceProfile as T;
    }
    case "voice_transcribe": {
      // The real command ships captured audio to an STT engine. A spec cannot
      // synthesise Opus, so the transcript is scripted through a global and the
      // mock asserts only the parts of the request the UI actually controls.
      const request = args.request as { audioBase64?: string; mimeType?: string; modelId?: string } | undefined;
      if (!request?.audioBase64) throw new Error("Audio payload is required.");
      return {
        text: globalState.__BASEBUILD_E2E_TRANSCRIPT__ ?? "",
        engine: s.voiceProfile.sttEngine,
        durationMs: 40,
      } as T;
    }
    case "voice_reset_mic_permission":
      return undefined as T;
    case "tool_catalog_list":
      return [] as T;
    case "tool_downloads_list":
      return [] as T;
    case "tool_download":
      return { toolId: String(args.toolId ?? ""), quant: String(args.quant ?? ""), localPath: "", sizeBytes: 0 } as T;
    case "tool_download_delete":
      return undefined as T;
    case "native_chat_steer": {
      // Mirrors the backend contract: a steer is accepted only while a turn is
      // actually in flight, otherwise the caller falls back to a normal send.
      const sessionId = args.sessionId as string;
      const content = String(args.content ?? "").trim();
      if (!content) throw new Error("Steering message is required.");
      if (!s.nativeChatRunning.includes(sessionId)) {
        return { delivered: false, message: null } as T;
      }
      const steerMessage: NativeChatMessage = {
        id: `nmsg-${s.nextNativeMessageId++}`,
        sessionId,
        role: "user",
        content,
        sortOrder: s.nativeChatMessages.filter((m) => m.sessionId === sessionId).length,
        providerId: "basebuild-local",
        modelId: "basebuild-local-coordinator",
        effortLevel: "medium",
        createdAt: Math.floor(Date.now() / 1000),
      };
      s.nativeChatMessages.push(steerMessage);
      __emit("native-chat://system-row", { sessionId, kind: "steered", value: 1 });
      return { delivered: true, message: steerMessage } as T;
    }
    case "native_chat_send": {
      const req = args.request as { sessionId: string; content: string; providerId?: string; modelId?: string; effortLevel?: string };
      const ts = Math.floor(Date.now() / 1000);
      const startedAt = Date.now();
      s.nativeChatRunning.push(req.sessionId);
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
      // Persist the user turn up front, matching the backend, so a steer that
      // arrives mid-stream lands after it instead of ahead of it.
      s.nativeChatMessages.push(userMessage);
      // Streaming trigger: emit phase + delta chunk events with real delays
      // before resolving, so e2e can assert the thinking indicator and
      // incremental markdown rendering (contract: native-chat://chunk with
      // { sessionId, delta, channel? } — channel "status" carries phases).
      const isMultiToolStream = req.content.includes("multi-tool-stream-test");
      const isApprovalStream = req.content.includes("approval-stream-test");
      const isStopPartial = req.content.includes("stop-partial-test");
      const isReasoningSplit = req.content.includes("reasoning-split-test");
      const isMultiTurnTools = req.content.includes("multi-turn-tools-test");
      const isStreamTest = req.content.includes("stream-test") && !isMultiToolStream && !isApprovalStream && !isStopPartial && !isReasoningSplit && !isMultiTurnTools;
      const streamedContent = "Streaming **bold** and `code` arrived incrementally.";
      if (isStreamTest || isMultiToolStream || isApprovalStream || isStopPartial || isReasoningSplit || isMultiTurnTools) {
        const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
        const chunk = (delta: string, channel?: string) =>
          __emit("native-chat://chunk", { sessionId: req.sessionId, delta, ...(channel ? { channel } : {}) });
        const toolEvent = (ev: Partial<NativeToolEvent> & { id: string; kind: string; status: string; sequence: number }) =>
          __emit("native-chat://tool-event", {
            sessionId: req.sessionId,
            toolCallId: ev.id,
            toolName: ev.kind,
            status: ev.status,
            summary: ev.summary ?? "",
            arguments: ev.arguments ?? null,
            diff: ev.diff ?? null,
            decision: ev.decision ?? null,
            ruleSource: ev.ruleSource ?? null,
          });
        chunk("thinking", "status");
        await sleep(300);
        chunk("Considering the request…", "reasoning");
        await sleep(200);

        if (isMultiToolStream || isApprovalStream) {
          // Real backend emits a "tools" status chunk before tool processing
          // (agent_loop_service: emit("tools", "status")) — mirror it so the
          // running-tools / waiting-approval indicator renders in e2e.
          chunk("tools", "status");
          // Emit tool events with incremental timestamps — tests ordering.
          const ts0 = Math.floor(Date.now() / 1000);
          toolEvent({ id: `te-read-${ts0}`, kind: "read_file", status: "running", summary: "Reading src/main.ts", arguments: JSON.stringify({ path: "src/main.ts" }), sequence: 1 });
          chunk("Let me read the file first.", "reasoning");
          await sleep(300);
          toolEvent({ id: `te-read-${ts0}`, kind: "read_file", status: "success", summary: "Read 120 lines", arguments: JSON.stringify({ path: "src/main.ts" }), sequence: 1 });
          await sleep(200);
          chunk("Now I'll edit the file.");
          await sleep(100);
          if (isApprovalStream) {
            // Real flow (agent_loop_service): text streams first, then a
            // "tools" status chunk, then await_approval emits BOTH a pending
            // tool-event AND an approval-request, then the loop BLOCKS.
            chunk("I need to edit **src/main.ts** to fix the bug.");
            await sleep(100);
            chunk("tools", "status");
            toolEvent({ id: `te-edit-${ts0}`, kind: "edit_file", status: "pending", summary: "Edit src/main.ts", arguments: JSON.stringify({ path: "src/main.ts", old_text: "foo", new_text: "bar" }), sequence: 2 });
            __emit("native-chat://approval-request", {
              sessionId: req.sessionId,
              toolCallId: `te-edit-${ts0}`,
              toolName: "edit_file",
              arguments: JSON.stringify({ path: "src/main.ts", old_text: "foo", new_text: "bar" }),
            });
            // Don't resolve — the test will click Allow/Deny or stop.
            // Keep the send promise alive — don't resolve yet.
            // The test will either resolve the approval or stop.
            // We resolve with a partial message after a long delay.
            await sleep(10000);
          } else {
            toolEvent({ id: `te-edit-${ts0}`, kind: "edit_file", status: "running", summary: "Editing src/main.ts", arguments: JSON.stringify({ path: "src/main.ts" }), diff: "-foo\n+bar\n", sequence: 2 });
            await sleep(300);
            toolEvent({ id: `te-edit-${ts0}`, kind: "edit_file", status: "success", summary: "Replaced 1 occurrence", arguments: JSON.stringify({ path: "src/main.ts" }), diff: "-foo\n+bar\n", sequence: 2 });
            await sleep(200);
            chunk("Now I'll run the tests.");
            await sleep(100);
            toolEvent({ id: `te-run-${ts0}`, kind: "run_command", status: "running", summary: "Running npm test", arguments: JSON.stringify({ command: "npm test" }), sequence: 3 });
            await sleep(300);
            toolEvent({ id: `te-run-${ts0}`, kind: "run_command", status: "success", summary: "exit 0:\nall tests passed", arguments: JSON.stringify({ command: "npm test" }), sequence: 3 });
            await sleep(200);
            chunk("All tests passed. The fix is complete.");
            await sleep(100);
          }
        } else if (isStopPartial) {
          // Emit partial text then hold — the user will press Stop.
          chunk("I'll analyze the");
          await sleep(200);
          chunk(" problem and");
          await sleep(200);
          chunk(" propose a");
          await sleep(200);
          // Hold here — the test will press Stop during this window.
          // Don't emit more chunks; don't resolve the promise.
          // The send promise will be cancelled by native_chat_cancel.
          // Keep the hold short (3s) so a follow-up send doesn't block long.
          await sleep(3000);
        } else if (isReasoningSplit) {
          // Reasoning → tool call → more reasoning → another tool → final text.
          // Tests that reasoning blocks split around tool calls.
          const ts0 = Math.floor(Date.now() / 1000);
          chunk("I need to read the file first.");
          await sleep(200);
          toolEvent({ id: `te-rs-read-${ts0}`, kind: "read_file", status: "running", summary: "Reading src/app.ts", arguments: JSON.stringify({ path: "src/app.ts" }), sequence: 1 });
          await sleep(200);
          toolEvent({ id: `te-rs-read-${ts0}`, kind: "read_file", status: "success", summary: "Read 80 lines", arguments: JSON.stringify({ path: "src/app.ts" }), sequence: 1 });
          await sleep(200);
          chunk("Now I see the issue. Let me fix it.", "reasoning");
          await sleep(200);
          toolEvent({ id: `te-rs-edit-${ts0}`, kind: "edit_file", status: "running", summary: "Editing src/app.ts", arguments: JSON.stringify({ path: "src/app.ts" }), diff: "-old\n+new\n", sequence: 2 });
          await sleep(200);
          toolEvent({ id: `te-rs-edit-${ts0}`, kind: "edit_file", status: "success", summary: "Replaced 1 line", arguments: JSON.stringify({ path: "src/app.ts" }), diff: "-old\n+new\n", sequence: 2 });
          await sleep(200);
          chunk("The fix is applied. The bug was in the null check.");
          await sleep(100);
        } else if (isMultiTurnTools) {
          // Single send that produces multiple tool calls with reasoning
          // between each — simulates a multi-step agent turn.
          const ts0 = Math.floor(Date.now() / 1000);
          for (let step = 1; step <= 3; step++) {
            chunk(`Step ${step}: analyzing`, "reasoning");
            await sleep(150);
            toolEvent({ id: `te-mt-${step}-${ts0}`, kind: `step_${step}`, status: "running", summary: `Running step ${step}`, arguments: JSON.stringify({ step }), sequence: step });
            await sleep(150);
            toolEvent({ id: `te-mt-${step}-${ts0}`, kind: `step_${step}`, status: "success", summary: `Step ${step} done`, arguments: JSON.stringify({ step }), sequence: step });
            await sleep(100);
          }
          chunk("All steps complete.");
          await sleep(100);
        } else {
          chunk("Streaming **bold**");
          await sleep(250);
          chunk(" and `code`");
          await sleep(250);
          chunk(" arrived incrementally.");
          await sleep(150);
        }
      }
      const assistantContent = isStreamTest
        ? streamedContent
        : isMultiToolStream
        ? "All tests passed. The fix is complete."
        : isApprovalStream
        ? "I need to edit src/main.ts to fix the bug."
        : isStopPartial
        ? "I'll analyze the problem and propose a"
        : isReasoningSplit
        ? "The fix is applied. The bug was in the null check."
        : isMultiTurnTools
        ? "All steps complete."
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
      const assistantReasoning = isReasoningSplit
        ? "I need to read the file first.\nNow I see the issue. Let me fix it."
        : isMultiTurnTools
        ? "Step 1: analyzing\nStep 2: analyzing\nStep 3: analyzing"
        : undefined;
      const assistantMessage: NativeChatMessage = {
        id: `nmsg-${s.nextNativeMessageId++}`,
        sessionId: req.sessionId,
        role: "assistant",
        content: assistantContent,
        reasoning: assistantReasoning,
        sortOrder: userMessage.sortOrder + 1,
        providerId: req.providerId ?? "basebuild-local",
        modelId: req.modelId ?? "basebuild-local-coordinator",
        effortLevel: req.effortLevel ?? "medium",
        createdAt: ts,
      };
      s.nativeChatRunning = s.nativeChatRunning.filter((id) => id !== req.sessionId);
      s.nativeChatMessages.push(assistantMessage);
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
      // Multi-tool-stream and approval-stream events were emitted live
      // during streaming above. Persist them so reload preserves them.
      const isMultiToolStreamPersist = isMultiToolStream;
      const isApprovalStreamPersist = isApprovalStream;
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
        : isMultiToolStreamPersist
        ? [
            { id: `te-read-${ts}`, sessionId: req.sessionId, messageId: assistantMessage.id, kind: "read_file", status: "success", summary: "Read 120 lines", arguments: JSON.stringify({ path: "src/main.ts" }), diff: null, decision: "approved", ruleSource: null, sequence: 1, createdAt: ts },
            { id: `te-edit-${ts}`, sessionId: req.sessionId, messageId: assistantMessage.id, kind: "edit_file", status: "success", summary: "Replaced 1 occurrence", arguments: JSON.stringify({ path: "src/main.ts" }), diff: "-foo\n+bar\n", decision: "approved", ruleSource: null, sequence: 2, createdAt: ts },
            { id: `te-run-${ts}`, sessionId: req.sessionId, messageId: assistantMessage.id, kind: "run_command", status: "success", summary: "exit 0:\nall tests passed", arguments: JSON.stringify({ command: "npm test" }), diff: null, decision: "approved", ruleSource: null, sequence: 3, createdAt: ts },
          ]
        : isApprovalStreamPersist
        ? [
            { id: `te-read-${ts}`, sessionId: req.sessionId, messageId: assistantMessage.id, kind: "read_file", status: "success", summary: "Read 120 lines", arguments: JSON.stringify({ path: "src/main.ts" }), diff: null, decision: "approved", ruleSource: null, sequence: 1, createdAt: ts },
            { id: `te-edit-${ts}`, sessionId: req.sessionId, messageId: assistantMessage.id, kind: "edit_file", status: "success", summary: "Edited src/main.ts", arguments: JSON.stringify({ path: "src/main.ts", old_text: "foo", new_text: "bar" }), diff: "-foo\n+bar\n", decision: "approved", ruleSource: null, sequence: 2, createdAt: ts },
          ]
        : isReasoningSplit
        ? [
            { id: `te-rs-read-${ts}`, sessionId: req.sessionId, messageId: assistantMessage.id, kind: "read_file", status: "success", summary: "Read 80 lines", arguments: JSON.stringify({ path: "src/app.ts" }), diff: null, decision: "approved", ruleSource: null, sequence: 1, createdAt: ts },
            { id: `te-rs-edit-${ts}`, sessionId: req.sessionId, messageId: assistantMessage.id, kind: "edit_file", status: "success", summary: "Replaced 1 line", arguments: JSON.stringify({ path: "src/app.ts" }), diff: "-old\n+new\n", decision: "approved", ruleSource: null, sequence: 2, createdAt: ts },
          ]
        : isMultiTurnTools
        ? [
            { id: `te-mt-1-${ts}`, sessionId: req.sessionId, messageId: assistantMessage.id, kind: "step_1", status: "success", summary: "Step 1 done", arguments: JSON.stringify({ step: 1 }), diff: null, decision: "approved", ruleSource: null, sequence: 1, createdAt: ts },
            { id: `te-mt-2-${ts}`, sessionId: req.sessionId, messageId: assistantMessage.id, kind: "step_2", status: "success", summary: "Step 2 done", arguments: JSON.stringify({ step: 2 }), diff: null, decision: "approved", ruleSource: null, sequence: 2, createdAt: ts },
            { id: `te-mt-3-${ts}`, sessionId: req.sessionId, messageId: assistantMessage.id, kind: "step_3", status: "success", summary: "Step 3 done", arguments: JSON.stringify({ step: 3 }), diff: null, decision: "approved", ruleSource: null, sequence: 3, createdAt: ts },
          ]
        : [];
      if (isToolCardTest || isSchematicWizardTest || isSchematicDenyTest || isMultiToolStreamPersist || isApprovalStreamPersist || isReasoningSplit || isMultiTurnTools) {
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
    case "native_provider_accounts_list": {
      const providerId = (args as { providerId?: string }).providerId ?? "";
      return Array.from(s.providerAccounts.values())
        .filter((a) => a.providerId === providerId)
        .map((a) => ({
          id: a.id,
          providerId: a.providerId,
          label: a.label,
          authMethod: a.authMethod,
          health: a.health,
          cooldownUntil: a.cooldownUntil,
          lastError: a.lastError,
          lastUsedAt: a.lastUsedAt,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        })) as T;
    }
    case "native_provider_account_logout": {
      const accountId = (args as { accountId?: string }).accountId ?? "";
      const acct = s.providerAccounts.get(accountId);
      s.providerAccounts.delete(accountId);
      if (acct) {
        const remaining = Array.from(s.providerAccounts.values()).filter((a) => a.providerId === acct.providerId).length;
        if (remaining === 0) {
          s.credentials.delete(acct.providerId);
          s.blockedProviders.add(acct.providerId);
        }
      }
      return undefined as T;
    }
    case "native_provider_account_set_label": {
      const accountId = (args as { accountId?: string }).accountId ?? "";
      const label = (args as { label?: string }).label ?? "";
      const acct = s.providerAccounts.get(accountId);
      if (acct) {
        acct.label = label;
        acct.updatedAt = Math.floor(Date.now() / 1000);
        s.providerAccounts.set(accountId, acct);
      }
      return undefined as T;
    }
    case "native_provider_account_test": {
      const accountId = (args as { accountId?: string }).accountId ?? "";
      const acct = s.providerAccounts.get(accountId);
      if (acct) {
        acct.health = "healthy";
        acct.lastError = null;
        acct.cooldownUntil = null;
        acct.updatedAt = Math.floor(Date.now() / 1000);
        return { ...acct } as T;
      }
      throw new Error("Account not found");
    }
    case "native_provider_account_usage": {
      const providerId = (args as { providerId?: string }).providerId ?? "";
      const accts = Array.from(s.providerAccounts.values()).filter((a) => a.providerId === providerId);
      const total = 10;
      return accts.map((a, i) => ({
        accountId: a.id,
        requests: i < accts.length ? total - i * 3 : 0,
        inputTokens: 1000 * (i + 1),
        outputTokens: 500 * (i + 1),
        costTotal: 0.01 * (i + 1),
        requestShare: accts.length > 0 ? (total - i * 3) / total : 0,
      })) as T;
    }
    case "native_provider_account_strategy": {
      return s.accountStrategy as T;
    }
    case "native_provider_account_strategy_set": {
      const strategy = (args as { strategy?: string }).strategy ?? "round_robin";
      s.accountStrategy = strategy;
      return undefined as T;
    }
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
      // Mirror the real backend: also upsert an account row.
      const acctId = `${req.providerId}_acct_${req.apiKey.slice(-4)}`;
      s.providerAccounts.set(acctId, {
        id: acctId,
        providerId: req.providerId,
        label: req.label || `${req.providerId} key …${req.apiKey.slice(-4)}`,
        authMethod: "api",
        health: "healthy",
        cooldownUntil: null,
        lastError: null,
        lastUsedAt: null,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      });
      return undefined as T;
    }
    case "__e2e_seed_provider_account": {
      const acct = args as { id: string; providerId: string; label: string; authMethod?: string; health?: string; lastError?: string | null };
      s.providerAccounts.set(acct.id, {
        id: acct.id,
        providerId: acct.providerId,
        label: acct.label,
        authMethod: acct.authMethod ?? "api",
        health: acct.health ?? "healthy",
        cooldownUntil: null,
        lastError: acct.lastError ?? null,
        lastUsedAt: null,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      });
      s.credentials.set(acct.providerId, { providerId: acct.providerId, apiKey: "seeded", baseUrl: null, updatedAt: Math.floor(Date.now() / 1000) });
      s.blockedProviders.delete(acct.providerId);
      return undefined as T;
    }
    case "native_delete_provider_credential": {
      const providerId = (args as { providerId?: string }).providerId ?? "unknown";
      s.blockedProviders.add(providerId);
      // Mirror real backend: log out all accounts for this provider.
      for (const [id, acct] of Array.from(s.providerAccounts.entries())) {
        if (acct.providerId === providerId) s.providerAccounts.delete(id);
      }
      s.credentials.delete(providerId);
      return undefined as T;
    }
    case "list_categories":
      return s.categories.filter((category) => category.sessionId === args.sessionId) as T;
    case "list_project_categories":
      return (args.projectPath === s.projectPath ? s.categories : []) as T;
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
    case "list_project_ideas":
      // Return a shallow copy so React detects the change after in-place
      // mutations like reject_idea/update_idea_status (which don't create
      // a new array reference, unlike delete_idea's .filter()).
      return (args.projectPath === s.projectPath ? s.ideas.map((idea) => ({ ...idea })) : []) as T;
    case "create_idea": {
      const ts = Math.floor(Date.now() / 1000);
      const idea: Idea = {
        id: `idea-${s.nextIdeaId++}`,
        sessionId: args.sessionId as string,
        categoryId: (args.categoryId as string | null) ?? null,
        title: args.title as string,
        description: args.description as string,
        status: "concept",
        grounding: (args.grounding as string | undefined) ?? "",
        anchor: (args.anchor as string | null | undefined) ?? null,
        batchId: s.activeRoundBySession.get(args.sessionId as string) ?? null,
        assessment: args.assessment as Idea["assessment"],
        createdAt: ts,
        updatedAt: ts,
      };
      s.ideas.push(idea);
      return idea as T;
    }
    case "update_idea": {
      const idea = s.ideas.find((item) => item.id === args.id);
      if (!idea) throw new Error(`Idea not found: ${String(args.id)}`);
      idea.title = args.title as string;
      idea.description = args.description as string;
      idea.categoryId = (args.categoryId as string | null) ?? null;
      idea.updatedAt = Math.floor(Date.now() / 1000);
      return idea as T;
    }
    case "start_idea_round": {
      const sessionId = args.sessionId as string;
      const ts = Math.floor(Date.now() / 1000);
      const prev = s.activeRoundBySession.get(sessionId);
      if (prev) {
        const prevRound = s.ideaRounds.find((r) => r.id === prev);
        if (prevRound) { prevRound.status = "succeeded"; prevRound.completedAt = ts; }
      }
      const id = `round-${s.nextRoundId++}`;
      s.ideaRounds.push({ id, sessionId, status: "running", createdAt: ts, completedAt: null });
      s.activeRoundBySession.set(sessionId, id);
      return id as T;
    }
    case "finish_idea_round": {
      const sessionId = args.sessionId as string;
      const active = s.activeRoundBySession.get(sessionId) ?? null;
      if (active) {
        s.activeRoundBySession.delete(sessionId);
        const round = s.ideaRounds.find((r) => r.id === active);
        if (round) { round.status = "succeeded"; round.completedAt = Math.floor(Date.now() / 1000); }
      }
      return active as T;
    }
    case "list_idea_rounds": {
      const sessionId = args.sessionId as string;
      const rounds: IdeaRound[] = s.ideaRounds
        .filter((r) => r.sessionId === sessionId)
        .map((r) => {
          const roundIdeas = s.ideas.filter((i) => i.batchId === r.id);
          const count = (status: string) => roundIdeas.filter((i) => i.status === status).length;
          return {
            id: r.id,
            sessionId: r.sessionId,
            status: r.status,
            createdAt: r.createdAt,
            completedAt: r.completedAt,
            conceptCount: count("concept"),
            pickedCount: count("picked"),
            rejectedCount: count("rejected"),
            archivedCount: count("archived"),
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
      return rounds as T;
    }
    case "update_idea_status": {
      const idea = s.ideas.find((item) => item.id === args.id);
      if (idea) idea.status = args.status as string;
      return undefined as T;
    }
    case "reject_idea": {
      const idea = s.ideas.find((item) => item.id === args.id);
      if (idea) {
        idea.status = "rejected";
        idea.updatedAt = Math.floor(Date.now() / 1000);
      }
      return undefined as T;
    }
    case "delete_idea":
      s.ideas = s.ideas.filter((idea) => idea.id !== args.id);
      return undefined as T;
    case "promote_ideas": {
      const input = args.input as { sessionId: string; ideaIds: string[] };
      const promoted: Plan[] = [];
      for (const ideaId of input.ideaIds) {
        const idea = s.ideas.find((item) => item.id === ideaId);
        if (!idea) throw new Error(`Idea not found: ${ideaId}`);
        const plan = makePlan(input.sessionId, {
          title: idea.title,
          description: idea.description,
        });
        s.plans.push(plan);
        idea.status = "picked";
        idea.updatedAt = Math.floor(Date.now() / 1000);
        promoted.push(plan);
      }
      return promoted as T;
    }
    case "native_generate_ideas": {
      const req = args.request as {
        sessionId: string;
        planningSessionId: string;
        providerId?: string;
        modelId?: string;
        effortLevel?: string;
        categoryIds?: string[];
        ideaCount?: number;
        displayMessage?: string;
        direction?: string | null;
      };
      const providerId = req.providerId ?? "basebuild-local";
      const ts = Math.floor(Date.now() / 1000);
      const displayMessage = req.displayMessage
        ?? `Idea Studio · basebuild-planning\n\nAuto-generate ${req.ideaCount ?? 8} project-wide ideas.`;
      const userMessage: NativeChatMessage = {
        id: `nmsg-${s.nextNativeMessageId++}`,
        sessionId: req.sessionId,
        role: "user",
        content: displayMessage,
        sortOrder: s.nativeChatMessages.filter((message) => message.sessionId === req.sessionId).length,
        providerId,
        modelId: req.modelId ?? "claude-sonnet-4",
        effortLevel: req.effortLevel ?? "medium",
        createdAt: ts,
      };
      s.nativeChatMessages.push(userMessage);

      // Only configured, non-local providers generate ideas in the fixture.
      if (providerId === "basebuild-local" || providerId === "openai") {
        return {
          ideas: [],
          setupRequired: { providerId, providerLabel: providerId === "openai" ? "OpenAI" : "Basebuild Local", message: "Choose a connected provider to run the native Idea Studio skill." },
          grounding: null,
          userMessage,
          assistantMessage: null,
        } as T;
      }

      const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      __emit("native-chat://chunk", { sessionId: req.sessionId, delta: "thinking", channel: "status" });
      await sleep(350);
      __emit("native-chat://chunk", { sessionId: req.sessionId, delta: "I’ll inspect the project and ground the ideas.", channel: "content" });
      __emit("native-chat://chunk", { sessionId: req.sessionId, delta: "tools", channel: "status" });
      const toolEvent: NativeToolEvent = {
        id: `ntool-idea-studio-${ts}-${s.nativeToolEvents.length}`,
        sessionId: req.sessionId,
        messageId: null,
        kind: "read_file",
        status: "succeeded",
        summary: "Read the project schematic.",
        arguments: JSON.stringify({ path: ".basebuild/project-schematic.md" }),
        diff: null,
        decision: "auto",
        ruleSource: null,
        sequence: s.nativeToolEvents.filter((event) => event.sessionId === req.sessionId).length + 1,
        createdAt: ts,
      };
      __emit("native-chat://tool-event", {
        sessionId: req.sessionId,
        toolCallId: toolEvent.id,
        toolName: toolEvent.kind,
        status: toolEvent.status,
        summary: toolEvent.summary,
        arguments: toolEvent.arguments,
        decision: toolEvent.decision,
        sequence: toolEvent.sequence,
      });
      s.nativeToolEvents.push(toolEvent);
      await sleep(250);

      const generated = [
        {
          title: "Improve onboarding",
          description: "Add a guided first-run tour.",
          grounding: "The existing first-run route has no guided state.",
          anchor: "src/components/onboarding",
          assessment: {
            schemaVersion: 1 as const,
            effort: { minHours: 4, maxHours: 8 },
            difficulty: 2,
            impact: 4,
            risk: 2,
            confidence: 4,
            rationale: "The flow is bounded to an existing component and persisted preference.",
            grounding: ["Existing onboarding components and preference storage."],
            requiredCapabilities: ["React", "Tauri settings"],
            constraints: ["Must remain dismissible and keyboard accessible."],
            missingEvidence: [],
            alternatives: ["Improve the empty state without a tour."],
          },
        },
        {
          title: "Cache provider catalog",
          description: "Avoid refetching on every mount.",
          grounding: "Catalog refresh currently runs when the provider view mounts.",
          anchor: "src/lib/providerCatalog",
          assessment: {
            schemaVersion: 1 as const,
            effort: { minHours: 3, maxHours: 6 },
            difficulty: 3,
            impact: 3,
            risk: 3,
            confidence: 3,
            rationale: "A last-good cache is small, but freshness and invalidation need explicit rules.",
            grounding: ["Existing provider catalog fetch and local persistence paths."],
            requiredCapabilities: ["Rust", "SQLite", "TypeScript"],
            constraints: ["Offline startup must preserve the last-good catalog."],
            missingEvidence: ["Observed catalog response size."],
            alternatives: ["Keep session-only memory caching."],
          },
        },
      ];
      for (const generatedIdea of generated) {
        const idea: Idea = {
          id: `idea-${s.nextIdeaId++}`,
          sessionId: req.planningSessionId,
          categoryId: req.categoryIds?.[0] ?? null,
          title: generatedIdea.title,
          description: generatedIdea.description,
          status: "concept",
          grounding: generatedIdea.grounding,
          anchor: generatedIdea.anchor,
          batchId: s.activeRoundBySession.get(req.planningSessionId) ?? null,
          assessment: generatedIdea.assessment,
          createdAt: ts,
          updatedAt: ts,
        };
        s.ideas.push(idea);
      }
      const proposalToolEvent: NativeToolEvent = {
        id: `ntool-idea-review-${ts}-${s.nativeToolEvents.length}`,
        sessionId: req.sessionId,
        messageId: null,
        kind: "propose_ideas",
        status: "success",
        summary: `Captured ${generated.length} grounded ideas.`,
        arguments: JSON.stringify({
          categoryId: req.categoryIds?.[0] ?? null,
          ideas: generated,
        }),
        diff: null,
        decision: "auto",
        ruleSource: null,
        sequence: s.nativeToolEvents.filter((event) => event.sessionId === req.sessionId).length + 1,
        createdAt: ts,
      };
      __emit("native-chat://tool-event", {
        sessionId: req.sessionId,
        toolCallId: proposalToolEvent.id,
        toolName: proposalToolEvent.kind,
        status: proposalToolEvent.status,
        summary: proposalToolEvent.summary,
        arguments: proposalToolEvent.arguments,
        decision: proposalToolEvent.decision,
        sequence: proposalToolEvent.sequence,
      });
      const assistantMessage: NativeChatMessage = {
        id: `nmsg-${s.nextNativeMessageId++}`,
        sessionId: req.sessionId,
        role: "assistant",
        content: `Captured ${generated.length} grounded ideas in Idea Studio.`,
        sortOrder: userMessage.sortOrder + 1,
        providerId,
        modelId: req.modelId ?? "claude-sonnet-4",
        effortLevel: req.effortLevel ?? "medium",
        createdAt: ts,
      };
      toolEvent.messageId = assistantMessage.id;
      proposalToolEvent.messageId = assistantMessage.id;
      s.nativeChatMessages.push(assistantMessage);
      s.nativeToolEvents.push(proposalToolEvent);
      return {
        ideas: generated,
        setupRequired: null,
        grounding: {
          schematicSections: ["Project Schematic", "Goals", "Vision"],
          finishedPlans: ["BB-0001", "BB-0002"],
          finishedPlanCount: 2,
          pickedCount: 1,
          rejectedCount: 0,
          digestEmpty: false,
        },
        userMessage,
        assistantMessage,
      } as T;
    }
    case "openspec_runtime_status":
      return {
        state: "ready",
        version: "1.0.0-e2e",
        executablePath: "C:\\basebuild-e2e\\openspec.exe",
        schema: "spec-driven",
        projectReady: true,
        message: null,
      } as T;
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
    case "list_runtime_profiles":
      return [
        { id: "basebuild-native", kind: "chat", label: "Basebuild Native", executable: "", args: [], env: {}, workingDirectoryMode: "project", workingDirectory: null, enabled: true },
        { id: "default-terminal", kind: "terminal", label: "Default Terminal", executable: "cmd.exe", args: [], env: {}, workingDirectoryMode: "project", workingDirectory: null, enabled: true },
      ] as T;
    case "set_runtime_defaults":
      return undefined as T;
    case "get_analytics_consent":
      return { collectionEnabled: false, uploadEnabled: false } as T;
    case "set_analytics_consent":
      return undefined as T;
    case "get_computer_id":
      return "00000000-0000-4000-8000-000000000000" as T;
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
    case "download_update":
      return "0.0.5" as T;
    case "apply_downloaded_update":
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
    case "usage_sync_retry":
      s.usageSyncRetried = true;
      return undefined as T;
    case "usage_sync_set_enabled":
      s.autoSyncEnabled = args.enabled as boolean;
      return undefined as T;
    case "get_approval_mode":
      return "auto" as T;
    case "set_approval_mode":
      return undefined as T;
    case "list_approval_rules":
      return [] as T;
    case "add_approval_rule":
    case "remove_approval_rule":
      return undefined as T;
    case "usage_sync_status":
      {
        const enabled = s.autoSyncEnabled ?? true;
        const now = Math.floor(Date.now() / 1000);
        const retried = s.usageSyncRetried ?? false;
        return {
          enabled,
          gatesPass: enabled,
          offReason: enabled ? undefined : "auto_sync_disabled",
          attribution: s.auth ? "account" : "private_installation",
          intervalMinutes: 60,
          lastSyncAt: now - 120,
          lastError: null,
          syncMode: "summary",
          overallOutcome: retried ? "success" : "partial",
          sources: [
            {
              source: "native",
              available: true,
              pendingRetry: false,
              lastSuccessAt: now - 120,
              lastProcessedAt: now - 90,
            },
            {
              source: "omp",
              available: false,
              availabilityReason: "Oh My Pi is not installed",
              pendingRetry: false,
            },
            {
              source: "claude-code",
              available: true,
              pendingRetry: !retried,
              lastSuccessAt: retried ? now : now - 3_600,
              lastProcessedAt: retried ? now : now - 3_590,
              lastError: retried ? undefined : "Upload was not acknowledged. Retry is pending.",
            },
            {
              source: "codex",
              available: true,
              pendingRetry: false,
              lastSuccessAt: now - 300,
              lastProcessedAt: now - 280,
            },
            {
              source: "opencode",
              available: false,
              availabilityReason: "OpenCode is not installed",
              pendingRetry: false,
            },
          ],
        } as T;
      }
    case "usage_sync_projected_usage":
      if (!s.auth) throw new Error("Account sign-in required for projected usage");
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
    case "usage_drain_rates":
      {
        // Locally solved, so unlike projected usage this needs no account.
        // The three rows cover the branches the UI has to be honest about:
        // a shared window projected to empty before it resets, a
        // single-model window with only one interval (no spread yet), and a
        // settled window that resets first.
        const nowMs = Date.now();
        return [
          {
            provider: "anthropic",
            limitId: "five_hour",
            modelId: null,
            planType: "Max 20x",
            windowLabel: "5h",
            intervals: 6,
            requests: 412,
            totalTokens: 3_180_000,
            durationMs: 11_520_000,
            fractionPer1kTokens: 0.000_244,
            fractionPerRequest: 0.001_9,
            fractionPerModelHour: 0.08,
            relativeSpread: 0.14,
            confidence: "high",
            models: ["claude-sonnet-4", "claude-haiku-4"],
            observedAt: nowMs - 4 * 60_000,
            remainingFraction: 0.23,
            resetsAt: nowMs + 95 * 60_000,
            projectedExhaustionAt: nowMs + 38 * 60_000,
            windowDurationMs: 18_000_000,
            requestsPerWindow: 526,
            requestsRemaining: 121,
            modelHoursPerWindow: 4.1,
            hoursPerWeek: 137.8,
            requestsUsedThisWindow: 405,
            hoursUsedThisWindow: 3.2,
          },
          {
            provider: "openai",
            limitId: "codex_weekly",
            modelId: "gpt-5-codex",
            planType: null,
            windowLabel: "7d",
            intervals: 1,
            requests: 24,
            totalTokens: 196_000,
            durationMs: 3_600_000,
            fractionPer1kTokens: 0.000_002_4,
            fractionPerRequest: 0.000_31,
            fractionPerModelHour: 0.02,
            relativeSpread: null,
            confidence: "low",
            models: ["gpt-5-codex"],
            observedAt: nowMs - 26 * 60_000,
            remainingFraction: 0.71,
            resetsAt: nowMs + 3 * 24 * 60 * 60_000,
            projectedExhaustionAt: null,
            windowDurationMs: 604_800_000,
            requestsPerWindow: 3225,
            requestsRemaining: 2290,
            modelHoursPerWindow: 134.4,
            hoursPerWeek: 134.4,
            requestsUsedThisWindow: 24,
            hoursUsedThisWindow: 1.0,
          },
          {
            provider: "google",
            limitId: "daily",
            modelId: null,
            planType: "Free",
            windowLabel: "24h",
            intervals: 3,
            requests: 58,
            totalTokens: 402_000,
            durationMs: 7_200_000,
            fractionPer1kTokens: 0.000_041,
            fractionPerRequest: 0.002_8,
            fractionPerModelHour: 0.07,
            relativeSpread: 0.41,
            confidence: "medium",
            models: ["gemini-2.5-pro"],
            observedAt: nowMs - 11 * 60_000,
            remainingFraction: 0.62,
            resetsAt: nowMs + 7 * 60 * 60_000,
            projectedExhaustionAt: nowMs + 19 * 60 * 60_000,
            // A window whose length the provider never names: the weekly
            // allowance stays unknown instead of being invented.
            windowDurationMs: null,
            requestsPerWindow: 357,
            requestsRemaining: 221,
            modelHoursPerWindow: 12.3,
            hoursPerWeek: null,
            // No window length, so the window's start is unknowable and no
            // used figure can be measured for it.
            requestsUsedThisWindow: 0,
            hoursUsedThisWindow: null,
          },
        ] as T;
      }
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
      return [
        { name: "basebuild-project-schematic", description: "Guided project schematic interview", source: "bundled", runtime: "both", path: "/skills/basebuild-project-schematic.md" },
        { name: "basebuild-session-title", description: "Generates concise session titles", source: "bundled", runtime: "native", path: "/skills/basebuild-session-title.md" },
        { name: "caveman", description: "Ultra-compressed communication mode", source: "user", runtime: "omp", path: "/skills/caveman.md" },
      ] as T;
    case "read_resolved_skill": {
      const skillName = (args.skillName as string) ?? "";
      return `# ${skillName}\n\nE2E stub content for ${skillName}.` as T;
    }
    case "read_skill": {
      const skillName = (args.skillName as string) ?? "";
      const cavemanBody = "You are a caveman. Speak in short grunts.";
      const schematicBody = "Help the user create a project schematic by asking one question at a time.";
      const body = skillName === "basebuild-project-schematic" ? schematicBody : cavemanBody;
      return { name: skillName, description: "E2E skill stub", content: body } as T;
    }
    case "provision_skill_dirs":
      return [] as T;
    case "startup_get_status":
      return {
        desired: s.startupDesired ?? false,
        effective: s.startupDesired ? "enabled" : "disabled",
        platformSupported: s.startupPlatformSupported ?? true,
        lastReconciliation: null,
      } as T;
    case "startup_enable":
      s.startupDesired = true;
      return {
        desired: true,
        effective: "enabled",
        platformSupported: s.startupPlatformSupported ?? true,
        lastReconciliation: { success: true, action: "repaired", error: null },
      } as T;
    case "startup_disable":
      s.startupDesired = false;
      return {
        desired: false,
        effective: "disabled",
        platformSupported: s.startupPlatformSupported ?? true,
        lastReconciliation: { success: true, action: "removed", error: null },
      } as T;
    case "startup_reconcile":
      return {
        desired: s.startupDesired ?? false,
        effective: s.startupDesired ? "enabled" : "disabled",
        platformSupported: s.startupPlatformSupported ?? true,
        lastReconciliation: { success: true, action: "noop", error: null },
      } as T;
    case "startup_launch_mode":
      return "foreground" as T;
    default:
      throw new Error(`Unhandled E2E Tauri command: ${command}`);
  }
}

// E2E hook: let Playwright tests drive mocked commands directly (e.g. seed
// ideas during a round). Mirrors the `__emit` hook in tauri-event.ts.
// Named cast: window carries test-only hooks the DOM lib cannot express.
type TestHookWindow = Window & { __basebuildInvoke?: typeof invoke };
if (typeof window !== "undefined") {
  const hookWindow: TestHookWindow = window;
  hookWindow.__basebuildInvoke = invoke;
}
