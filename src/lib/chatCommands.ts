/**
 * Chat command palette metadata, filtering, ranking, and argument helpers.
 *
 * This module is pure (no React, no Tauri invokes) so it can be unit-tested
 * in isolation. The ChatPanel component wires these helpers into the composer
 * UI and dispatches built-in commands.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Where a command originates — controls source badge rendering. */
export type CommandSource =
  | "builtin" // Basebuild first-party UI command
  | "omp-project" // <project>/.omp/commands/*.md
  | "omp-user" // ~/.omp/agent/commands/*.md
  | "claude" // .claude/commands/**/*.md
  | "codex" // .codex/commands/*.md
  | "skill" // /skill:<name>
  | "mcp"; // MCP prompt command

/** A single argument definition for inline helper display. */
export type CommandArgument = {
  name: string;
  required: boolean;
  description?: string;
  /** Placeholder shown in the composer after Tab completion. */
  placeholder?: string;
};

/** Normalized command metadata for palette rendering and dispatch. */
export type ChatCommand = {
  /** Command name without the leading `/`. For skills: `skill:<name>`. */
  name: string;
  description: string;
  /** Usage string, e.g. `/model [query]`. */
  usage: string;
  arguments: CommandArgument[];
  examples: string[];
  source: CommandSource;
  /**
   * Command category — distinguishes commands that act inside the chat
   * (inject skills, generate ideas, show reference output) from commands
   * that trigger a Basebuild UI action (open a picker, clear chat, stop).
   * - "in-chat" — does something in the conversation: injects a skill,
   *   generates ideas, shows command reference output, etc.
   * - "ui" — triggers a Basebuild UI action: opens a picker/modal/tab,
   *   clears chat, stops a request, refreshes catalog.
   * Every command MUST be one or the other — no command that only shows
   * a static text notice and does nothing else.
   */
  category: "in-chat" | "ui";
  /** If true, executes a local UI action and never sends to the provider. */
  localOnly: boolean;
  /** If true, expands into a prompt sent to the provider. */
  expandsToPrompt: boolean;
  /** Shadowed by a higher-priority command with the same name. */
  shadowed?: boolean;
  /** Epoch ms of last use, if known from recency data. */
  recentlyUsedAt?: number;
};

// ─── Built-in command definitions ────────────────────────────────────────────

export const BUILTIN_COMMANDS: ChatCommand[] = [
  {
    name: "clear",
    description: "Clear the current chat transcript. Confirms before deleting persisted messages.",
    usage: "/clear",
    arguments: [],
    examples: ["/clear"],
    source: "builtin",
    category: "ui",
    localOnly: true,
    expandsToPrompt: false,
  },
  {
    name: "new",
    description: "Start a fresh empty chat for the current project. Keeps the previous chat.",
    usage: "/new",
    arguments: [],
    examples: ["/new"],
    source: "builtin",
    category: "ui",
    localOnly: true,
    expandsToPrompt: false,
  },
  {
    name: "model",
    description: "Open the model picker to switch the active chat model. Optional filter narrows the list.",
    usage: "/model [query]",
    arguments: [
      { name: "query", required: false, description: "Filter models by provider, id, or label", placeholder: "sonnet" },
    ],
    examples: ["/model", "/model sonnet", "/model claude"],
    source: "builtin",
    category: "ui",
    localOnly: true,
    expandsToPrompt: false,
  },
  {
    name: "provider",
    description: "Open the provider picker to switch the active chat provider. Optional filter narrows the list.",
    usage: "/provider [query]",
    arguments: [
      { name: "query", required: false, description: "Filter providers by id or label", placeholder: "openai" },
    ],
    examples: ["/provider", "/provider openai", "/provider anthropic"],
    source: "builtin",
    category: "ui",
    localOnly: true,
    expandsToPrompt: false,
  },
  {
    name: "models refresh",
    description: "Force a refresh of the model catalog from connected providers.",
    usage: "/models refresh",
    arguments: [],
    examples: ["/models refresh"],
    source: "builtin",
    category: "ui",
    localOnly: true,
    expandsToPrompt: false,
  },
  {
    name: "commands",
    description: "Show the complete command reference with names, descriptions, usage, categories, and sources.",
    usage: "/commands",
    arguments: [],
    examples: ["/commands"],
    source: "builtin",
    category: "in-chat",
    localOnly: true,
    expandsToPrompt: false,
  },
  {
    name: "help",
    description: "Show the command reference plus a keyboard guide for the command palette.",
    usage: "/help",
    arguments: [],
    examples: ["/help"],
    source: "builtin",
    category: "in-chat",
    localOnly: true,
    expandsToPrompt: false,
  },
  {
    name: "stop",
    description: "Cancel the current running chat request. Reports idle if nothing is running.",
    usage: "/stop",
    arguments: [],
    examples: ["/stop"],
    source: "builtin",
    category: "ui",
    localOnly: true,
    expandsToPrompt: false,
  },
  {
    name: "login",
    description: "Open the provider connection UI to sign in with a provider.",
    usage: "/login [provider]",
    arguments: [
      { name: "provider", required: false, description: "Provider id or label to preselect", placeholder: "anthropic" },
    ],
    examples: ["/login", "/login anthropic"],
    source: "builtin",
    category: "ui",
    localOnly: true,
    expandsToPrompt: false,
  },
  {
    name: "mcp",
    description: "Manage MCP servers. Opens Settings to the MCP servers section.",
    usage: "/mcp",
    arguments: [],
    examples: ["/mcp"],
    source: "builtin",
    category: "ui",
    localOnly: true,
    expandsToPrompt: false,
  },
  {
    name: "plan",
    description: "Plan commands: list, run <ref>, status. Executes planning UI actions.",
    usage: "/plan [subcommand]",
    arguments: [
      { name: "subcommand", required: false, description: "list | run <ref> | status", placeholder: "list" },
    ],
    examples: ["/plan list", "/plan run my-plan"],
    source: "builtin",
    category: "ui",
    localOnly: true,
    expandsToPrompt: false,
  },
  {
    name: "idea",
    description: "Idea commands: generate, promote. Generate injects the planning skill into chat.",
    usage: "/idea [subcommand]",
    arguments: [
      { name: "subcommand", required: false, description: "generate | promote", placeholder: "generate" },
    ],
    examples: ["/idea generate"],
    source: "builtin",
    category: "in-chat",
    localOnly: true,
    expandsToPrompt: false,
  },
  {
    name: "openspec",
    description: "OpenSpec commands: generate <ref>, progress <ref>. Executes OpenSpec UI actions.",
    usage: "/openspec [subcommand]",
    arguments: [
      { name: "subcommand", required: false, description: "generate <ref> | progress <ref>", placeholder: "generate" },
    ],
    examples: ["/openspec generate my-change"],
    source: "builtin",
    category: "ui",
    localOnly: true,
    expandsToPrompt: false,
  },
  {
    name: "schematic",
    description: "Start the project schematic wizard in chat. Injects the schematic skill — the agent interviews you section by section to create or update .basebuild/project-schematic.md.",
    usage: "/schematic [wizard|view|inspect]",
    arguments: [
      { name: "subcommand", required: false, description: "wizard (default) | view | inspect", placeholder: "wizard" },
    ],
    examples: ["/schematic", "/schematic wizard", "/schematic view", "/schematic inspect"],
    source: "builtin",
    category: "in-chat",
    localOnly: false,
    expandsToPrompt: true,
  },
  {
    name: "skill:",
    description: "Inject a skill's content into the conversation. Type /skill: followed by the skill name.",
    usage: "/skill:<name> [args]",
    arguments: [
      { name: "name", required: true, description: "Skill name", placeholder: "basebuild-session-title" },
      { name: "args", required: false, description: "Optional arguments for the skill" },
    ],
    examples: ["/skill:basebuild-session-title retitle this"],
    source: "skill",
    category: "in-chat",
    localOnly: false,
    expandsToPrompt: true,
  },
];

// ─── Recency persistence ─────────────────────────────────────────────────────

const RECENCY_KEY = "bb:commandRecency";
const RECENCY_CAP = 20;

/** Read the recency map (command name → epoch ms of last use). */
export function readCommandRecency(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RECENCY_KEY);
    return raw ? JSON.parse(raw) as Record<string, number> : {};
  } catch {
    return {};
  }
}

/** Record a command use and persist the updated recency map (capped). */
export function recordCommandUse(name: string, now: number = Date.now()): Record<string, number> {
  const current = readCommandRecency();
  current[name] = now;
  // Prune oldest entries if over cap.
  const entries = Object.entries(current).sort((a, b) => b[1] - a[1]);
  const pruned = entries.slice(0, RECENCY_CAP);
  const result = Object.fromEntries(pruned);
  try {
    localStorage.setItem(RECENCY_KEY, JSON.stringify(result));
  } catch {
    // ignore quota errors
  }
  return result;
}

/** Parsed command payload from a user message that wraps injected context. */
export type CommandPayload = {
  name: string;
  content: string;
  trailing: string;
};

const COMMAND_PAYLOAD_REGEX = /^<command name="([^"]+)\">\n?([\s\S]*?)\n?<\/command>\n?([\s\S]*)$/;

/**
 * Detect a wrapped command payload in a user message.
 * Matches: <command name="/skill:caveman">...skill content...</command>rest
 * Returns null when no payload is present.
 */
export function parseCommandPayload(text: string): CommandPayload | null {
  const match = text.match(COMMAND_PAYLOAD_REGEX);
  if (!match) return null;
  return {
    name: match[1],
    content: match[2],
    trailing: match[3].replace(/^\n/, ""),
  };
}

// ─── Filtering & ranking ─────────────────────────────────────────────────────

/** Source priority — higher wins (mirrors slash-command-registry spec). */
const SOURCE_PRIORITY: Record<CommandSource, number> = {
  builtin: 100,
  "omp-project": 90,
  "omp-user": 90,
  claude: 80,
  codex: 70,
  skill: 60,
  mcp: 50,
};

export type RankedCommand = ChatCommand & {
  /** 0 = exact match, 1 = prefix, 2 = substring, 3 = no match (only for unfiltered lists). */
  matchType: 0 | 1 | 2 | 3;
  /** Sort key — lower sorts first. */
  sortKey: number;
};

/**
 * Filter and rank commands by a query string (the text after `/`).
 * When query is empty, returns all commands ranked by recency then source priority.
 * Shadowed commands are excluded from the main list but can be requested separately.
 */
export function filterAndRank(
  commands: ChatCommand[],
  query: string,
  recency: Record<string, number> = {},
): RankedCommand[] {
  const q = query.trim().toLowerCase();

  // Attach recency timestamps.
  const withRecency = commands.map((c) => ({
    ...c,
    recentlyUsedAt: recency[c.name] ?? recency[c.name.toLowerCase()] ?? undefined,
  }));

  if (!q) {
    // No filter: rank by recency first, then source priority, then name.
    return withRecency
      .filter((c) => !c.shadowed)
      .map((c) => ({
        ...c,
        matchType: 3 as const,
        sortKey: computeSortKey(c, 3, recency),
      }))
      .sort((a, b) => a.sortKey - b.sortKey);
  }

  const ranked: RankedCommand[] = [];
  for (const c of withRecency) {
    if (c.shadowed) continue;
    const name = c.name.toLowerCase();
    let matchType: 0 | 1 | 2 | 3;
    if (name === q) {
      matchType = 0;
    } else if (name.startsWith(q)) {
      matchType = 1;
    } else if (name.includes(q)) {
      matchType = 2;
    } else {
      // Also check description for substring matches.
      if (c.description.toLowerCase().includes(q)) {
        matchType = 2;
      } else {
        continue;
      }
    }
    ranked.push({ ...c, matchType, sortKey: computeSortKey(c, matchType, recency) });
  }

  return ranked.sort((a, b) => a.sortKey - b.sortKey);
}

function computeSortKey(
  c: ChatCommand,
  matchType: number,
  recency: Record<string, number>,
): number {
  // Sort key: [matchType (0-3)] [hasRecency (0/1)] [sourcePriority reversed] [name]
  // Lower = first. Recent commands float to the top within the same match tier.
  const hasRecency = recency[c.name] ?? recency[c.name.toLowerCase()] ?? 0;
  const recencyBit = hasRecency > 0 ? 0 : 1;
  const sourcePriority = SOURCE_PRIORITY[c.source] ?? 0;
  // Encode as a comparable number: matchType * 1e6 + recencyBit * 1e5 + (100 - sourcePriority) * 1000 + alphaRank
  // alphaRank is 0-999 based on first char for stable ordering.
  const alphaRank = c.name.charCodeAt(0) ?? 0;
  return matchType * 1_000_000 + recencyBit * 100_000 + (100 - sourcePriority) * 1000 + alphaRank;
}

// ─── Argument helpers ────────────────────────────────────────────────────────

export type CommandHelper = {
  /** The matched command, or null if no match. */
  command: ChatCommand | null;
  /** Human-readable usage line. */
  usage: string;
  /** Required argument names. */
  requiredArgs: string[];
  /** Optional argument names. */
  optionalArgs: string[];
  /** Example strings. */
  examples: string[];
  /** Validation error, if any. */
  validationError: string | null;
  /** Whether this command executes locally (true) or sends to the provider (false). */
  localOnly: boolean;
  /** Whether the command name is recognized at all. */
  recognized: boolean;
};

/**
 * Parse the composer draft and produce helper text for the active command.
 * @param draft The full composer text (e.g. `/model son`).
 * @param commands The full command list to match against.
 */
export function buildCommandHelper(
  draft: string,
  commands: ChatCommand[] = BUILTIN_COMMANDS,
): CommandHelper {
  const trimmed = draft.trim();
  if (!trimmed.startsWith("/")) {
    return {
      command: null,
      usage: "",
      requiredArgs: [],
      optionalArgs: [],
      examples: [],
      validationError: null,
      localOnly: false,
      recognized: false,
    };
  }

  const withoutSlash = trimmed.slice(1);
  const tokens = withoutSlash.split(/\s+/);
  const firstToken = (tokens[0] ?? "").toLowerCase();
  const rest = tokens.slice(1).join(" ").trim();

  // Special handling for /skill:<name>
  if (firstToken.startsWith("skill:")) {
    const skillName = firstToken.slice(6);
    const skillCmd = commands.find((c) => c.name === "skill:");
    if (skillCmd) {
      const validationError = !skillName
        ? "Skill name is required after /skill:"
        : null;
      return {
        command: skillCmd,
        usage: skillCmd.usage,
        requiredArgs: skillCmd.arguments.filter((a) => a.required).map((a) => a.name),
        optionalArgs: skillCmd.arguments.filter((a) => !a.required).map((a) => a.name),
        examples: skillCmd.examples,
        validationError,
        localOnly: skillCmd.localOnly,
        recognized: true,
      };
    }
  }

  // Match by first token, or first two tokens for multi-word commands like "models refresh".
  let matched = commands.find(
    (c) => c.name.toLowerCase() === firstToken,
  );
  if (!matched && tokens.length >= 2) {
    const twoWord = `${firstToken} ${(tokens[1] ?? "").toLowerCase()}`;
    matched = commands.find((c) => c.name.toLowerCase() === twoWord);
  }

  if (!matched) {
    return {
      command: null,
      usage: "",
      requiredArgs: [],
      optionalArgs: [],
      examples: [],
      validationError: `Unknown command: /${firstToken}. Type /commands to see all available commands.`,
      localOnly: false,
      recognized: false,
    };
  }

  // Validate required arguments.
  const requiredArgs = matched.arguments.filter((a) => a.required);
  const validationError = requiredArgs.length > 0 && !rest
    ? `Missing required argument: ${requiredArgs.map((a) => a.name).join(", ")}`
    : null;

  return {
    command: matched,
    usage: matched.usage,
    requiredArgs: requiredArgs.map((a) => a.name),
    optionalArgs: matched.arguments.filter((a) => !a.required).map((a) => a.name),
    examples: matched.examples,
    validationError,
    localOnly: matched.localOnly,
    recognized: true,
  };
}

/**
 * Produce the Tab-completed composer text for a command.
 * Inserts required argument placeholders.
 */
export function tabComplete(command: ChatCommand): string {
  const requiredPlaceholders = command.arguments
    .filter((a) => a.required && a.placeholder)
    .map((a) => a.placeholder ?? a.name)
    .join(" ");
  return requiredPlaceholders
    ? `/${command.name} ${requiredPlaceholders} `
    : `/${command.name} `;
}

/**
 * Format the command reference for /commands and /help output.
 * Returns an array of { name, description, usage, source, category } lines.
 */
export function formatCommandReference(commands: ChatCommand[] = BUILTIN_COMMANDS): Array<{
  name: string;
  description: string;
  usage: string;
  source: string;
  category: "in-chat" | "ui";
  localOnly: boolean;
}> {
  return commands
    .filter((c) => !c.shadowed)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      name: c.name,
      description: c.description,
      usage: c.usage,
      source: c.source,
      category: c.category,
      localOnly: c.localOnly,
    }));
}

/** Human-readable source badge label. */
export function sourceLabel(source: CommandSource): string {
  switch (source) {
    case "builtin": return "Built-in";
    case "omp-project": return "OMP Project";
    case "omp-user": return "OMP User";
    case "claude": return "Claude";
    case "codex": return "Codex";
    case "skill": return "Skill";
    case "mcp": return "MCP";
  }
}

/** Human-readable category badge label. */
export function categoryLabel(category: "in-chat" | "ui"): string {
  return category === "in-chat" ? "In-Chat" : "UI";
}

/** Keyboard guide text for /help. */
export const KEYBOARD_GUIDE: string[] = [
  "Keyboard guide:",
  "  Type / to open the command palette.",
  "  Arrow Up/Down — move selection through the list.",
  "  Tab — complete the selected command into the composer.",
  "  Enter — submit or accept the active command.",
  "  Escape — close the palette without changing the draft.",
  "  Click the Commands button to open the palette without typing /.",
];
