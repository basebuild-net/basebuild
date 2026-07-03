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
  kind: "terminal" | "empty" | "file" | "chat";
  title: string;
  terminalId: number | null;
  filePath: string | null;
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
  createdAt: number;
  updatedAt: number;
};

type NativeChatMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
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

type Plan = {
  id: string;
  sessionId: string;
  referenceId: string;
  title: string;
  description: string;
  goal: string | null;
  status: "draft" | "openspec" | "waiting" | "in_progress" | "finished" | "cancelled";
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
  nativeChatMessages: NativeChatMessage[];
  nativeRequestMetrics: NativeRequestMetric[];
  ideas: Idea[];
  nextIdeaId: number;
  workspaceRestoreByProject: Map<string, unknown>;
  auth: { accessToken: string; expiresAt: string; scopes: string[]; user: { id: string; username: string; email: string; image: string | null; isAdmin: boolean; isEditor: boolean } | null } | null;
  updateInstallCount: number;
};

const globalState = globalThis as typeof globalThis & { __BASEBUILD_E2E_STATE__?: E2eState };


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
      ideas: [],
      nextIdeaId: 1,
      workspaceRestoreByProject: new Map(),
      auth: null,
      updateInstallCount: 0,
    };
  }
  return globalState.__BASEBUILD_E2E_STATE__;
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
      return [] as T;
    case "pick_project_directory":
      return s.projectPath as T;
    case "remember_recent_project":
      return { path: args.path as string, name: "project", lastOpenedAt: Math.floor(Date.now() / 1000), lastActiveSessionId: null } as T;
    case "remove_recent_project":
    case "set_last_active_session":
    case "reveal_in_explorer":
    case "set_project_schematic":
    case "delete_tab":
    case "write_terminal":
    case "resize_terminal":
    case "close_terminal":
    case "agent_send":
    case "agent_stop":
      return undefined as T;
    case "detect_project":
      return { path: args.path as string, gitRoot: args.path as string, hasGit: true, hasOpenSpec: true, hasBasebuild: true } as T;
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
    case "has_project_schematic":
      return true as T;
    case "get_project_schematic":
      return { content: "# Project Schematic: E2E Fixture\n\n## Purpose\nExercise plan context generation." } as T;
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
    case "list_files":
      return [] as T;
    case "read_file":
      return "E2E context file" as T;
    case "create_terminal":
      return { id: s.nextTerminalId++, shell: args.shell, cwd: args.cwd ?? null, pid: 1234, rows: 24, cols: 80, startedAt: Math.floor(Date.now() / 1000), alive: true } as T;
    case "list_terminals":
      return [] as T;
    case "agent_start":
      return 1 as T;
    case "native_provider_catalog":
    case "native_provider_catalog_refresh":
      return {
        providers: [
          { id: "basebuild-local", label: "Basebuild Local", status: "ready", credentialOwner: "basebuild", configured: true, localOnly: true, detail: "Local coordinator", authMethod: "local", apiKeyUrl: null, modelCount: 1, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
          { id: "openai", label: "OpenAI", status: "setup_required", credentialOwner: "user", configured: false, localOnly: false, detail: "Configure credentials", authMethod: "api_key", apiKeyUrl: "https://platform.openai.com/api-keys", modelCount: 1, lastSyncedAt: 1_800_000_000, source: "bundled", error: null },
          { id: "umans", label: "Umans", status: "ready", credentialOwner: "user", configured: true, localOnly: false, detail: "Connected", authMethod: "api_key", apiKeyUrl: "https://app.umans.ai/billing?context=personal&tab=api-keys", modelCount: 1, lastSyncedAt: 1_800_000_000, source: "provider_discovered", error: null },
        ],
        models: [
          { id: "basebuild-local-coordinator", providerId: "basebuild-local", label: "Local Coordinator", supportsEffort: true, supportsStreaming: false, localOnly: true, contextWindow: null, maxTokens: null, supportsReasoning: true, supportedEfforts: ["low", "medium", "high", "xhigh"], supportsImages: false, source: "bundled" },
          { id: "gpt-5.1", providerId: "openai", label: "GPT-5.1", supportsEffort: true, supportsStreaming: true, localOnly: false, contextWindow: 400000, maxTokens: null, supportsReasoning: true, supportedEfforts: ["low", "medium", "high", "xhigh"], supportsImages: true, source: "bundled" },
          { id: "umans-glm-5.2", providerId: "umans", label: "Umans GLM 5.2", supportsEffort: true, supportsStreaming: true, localOnly: false, contextWindow: 128000, maxTokens: null, supportsReasoning: true, supportedEfforts: ["low", "medium", "high", "xhigh"], supportsImages: false, source: "provider_discovered" },
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
      const assistantContent = `Native harness echo: ${req.content}`;
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
      return {
        userMessage,
        assistantMessage,
        metrics: metric,
        toolEvents: [],
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
      return (s.workspaceRestoreByProject.get(projectPath) ?? {
        projectPath,
        lastSessionId: null,
        lastTabId: null,
        sideSection: "plans",
        sidebarCollapsed: false,
        sideCollapsed: false,
        sideWidth: 260,
        updatedAt: 0,
      }) as T;
    }
    case "save_workspace_restore_state":
      s.workspaceRestoreByProject.set((args.state as { projectPath: string }).projectPath, args.state);
      return args.state as T;
    case "update_tab_chat_session":
      return undefined as T;
    case "native_save_provider_credential":
      return { providerId: "umans", label: "Umans", apiKey: "test-key", baseUrl: null, updatedAt: Math.floor(Date.now() / 1000) } as T;
    case "native_list_provider_credentials":
      return [] as T;
    case "native_delete_provider_credential":
      return undefined as T;
    case "list_categories":
      return [] as T;
    case "create_category":
      return { id: `cat-${Date.now()}`, sessionId: args.sessionId as string, name: args.name as string, description: args.description as string, createdAt: Math.floor(Date.now() / 1000) } as T;
    case "delete_category":
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
        } as T;
      }
      return {
        ideas: [
          { title: "Improve onboarding", description: "Add a guided first-run tour." },
          { title: "Cache provider catalog", description: "Avoid refetching on every mount." },
        ],
        setupRequired: null,
      } as T;
    }
    case "native_provider_login_start":
      return { providerId: args.providerId as string, providerLabel: "OpenAI", landingUrl: "http://127.0.0.1:0/", providerUrl: "https://example.com/keys" } as T;
    case "native_provider_login_poll":
      return { status: "success", message: null } as T;
    case "native_provider_login_cancel":
      return undefined as T;
    case "omp_status":
      return { installed: false, version: null, path: null } as T;
    case "omp_debug_context":
      return { stats: null, usage: null, config: null } as T;
    case "list_requirements":
      return [] as T;
    case "get_runtime_defaults":
      return { defaultChatProfileId: "basebuild-native", defaultTerminalProfileId: "default-terminal", defaultModel: "basebuild-local-coordinator", autoSendGeneratedPrompts: false } as T;
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
    default:
      throw new Error(`Unhandled E2E Tauri command: ${command}`);
  }
}
