import { invoke } from "@tauri-apps/api/core";

// ─── Types ───

export type ConfigSource = "project" | "user";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "failed";

export type ServerState = {
  name: string;
  source: ConfigSource;
  state: ConnectionState;
  toolCount: number;
  promptCount: number;
  error: string | null;
};

export type McpServerEntry = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
  oauth?: {
    clientId?: string;
    clientSecret?: string;
    scopes?: string[];
    redirectUrl?: string;
  };
};

export type LoadResult = {
  servers: Array<{
    name: string;
    entry: McpServerEntry;
    source: ConfigSource;
    file: string;
  }>;
  errors: Array<{
    server: string;
    file: string;
    message: string;
  }>;
  disabled: string[];
};

export type NamespacedTool = {
  namespacedName: string;
  server: string;
  tool: {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  };
};

export type NamespacedPrompt = {
  namespacedName: string;
  server: string;
  prompt: {
    name: string;
    description?: string;
    arguments?: Array<{
      name: string;
      description?: string;
      required?: boolean;
    }>;
  };
};

export type McpOAuthStart = {
  serverUrl: string;
  authUrl: string;
  landingUrl: string;
};

export type McpOAuthPoll = {
  status: "pending" | "success" | "error" | "cancelled";
  message: string | null;
};

// ─── Commands ───

/** Reload MCP configs for a project and (re)connect enabled servers. */
export async function mcpReload(projectPath: string): Promise<LoadResult> {
  return invoke<LoadResult>("mcp_reload", { projectPath });
}

/** List all discovered MCP servers with their connection state. */
export async function mcpListServers(projectPath: string): Promise<ServerState[]> {
  return invoke<ServerState[]>("mcp_list_servers", { projectPath });
}

/** List all tools from connected servers, namespaced `mcp:<server>/<tool>`. */
export async function mcpListTools(projectPath: string): Promise<NamespacedTool[]> {
  return invoke<NamespacedTool[]>("mcp_list_tools", { projectPath });
}

/** List all prompts from connected servers as slash commands. */
export async function mcpListPrompts(projectPath: string): Promise<NamespacedPrompt[]> {
  return invoke<NamespacedPrompt[]>("mcp_list_prompts", { projectPath });
}

/** Disconnect a specific server. */
export async function mcpDisconnect(
  projectPath: string,
  serverName: string,
): Promise<void> {
  return invoke("mcp_disconnect", { projectPath, serverName });
}

/** Call an MCP tool through the approval gateway. */
export async function mcpCallTool(
  projectPath: string,
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  sessionId?: string,
): Promise<unknown> {
  return invoke("mcp_call_tool", {
    projectPath,
    serverName,
    toolName,
    arguments: args,
    sessionId: sessionId ?? null,
  });
}

/** Get an MCP prompt from a connected server. */
export async function mcpGetPrompt(
  projectPath: string,
  serverName: string,
  promptName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return invoke("mcp_get_prompt", {
    projectPath,
    serverName,
    promptName,
    arguments: args,
  });
}

// ─── OAuth ───

/** Start an OAuth flow for an HTTP/SSE MCP server. */
export async function mcpOAuthStart(serverUrl: string): Promise<McpOAuthStart> {
  return invoke<McpOAuthStart>("mcp_oauth_start", { serverUrl });
}

/** Poll an in-flight OAuth flow. */
export async function mcpOAuthPoll(serverUrl: string): Promise<McpOAuthPoll> {
  return invoke<McpOAuthPoll>("mcp_oauth_poll", { serverUrl });
}

/** Cancel an in-flight OAuth flow. */
export async function mcpOAuthCancel(serverUrl: string): Promise<void> {
  return invoke("mcp_oauth_cancel", { serverUrl });
}

/** Clear the stored OAuth token for a server URL. */
export async function mcpOAuthClear(serverUrl: string): Promise<void> {
  return invoke("mcp_oauth_clear", { serverUrl });
}

/** Disconnect all MCP servers for a project. */
export async function mcpShutdownAll(projectPath: string): Promise<void> {
  return invoke("mcp_shutdown_all", { projectPath });
}
