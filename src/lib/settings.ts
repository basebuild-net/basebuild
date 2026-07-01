import { invoke } from "@tauri-apps/api/core";

// ─── Types ───

export type AgentCapability =
  | "chat"
  | "messages"
  | "skills"
  | "providers"
  | "commands"
  | "info";

export type RuntimeProfileKind = "chat" | "terminal";

export type WorkingDirectoryMode = "project" | "home" | "custom";

export type RuntimeProfile = {
  id: string;
  kind: RuntimeProfileKind;
  label: string;
  executable: string;
  args: string[];
  workingDirectoryMode: WorkingDirectoryMode;
  defaultModel: string | null;
  capabilities: AgentCapability[];
  builtIn: boolean;
};

export type RuntimeDefaults = {
  defaultChatProfileId: string | null;
  defaultTerminalProfileId: string | null;
  defaultModel: string | null;
  autoSendGeneratedPrompts: boolean;
};

export type PermissionDecision = "ask" | "allow" | "deny";

export type PermissionRules = {
  allowCommandExecution: PermissionDecision;
  allowExternalContext: PermissionDecision;
  allowFileModification: PermissionDecision;
  allowUsageAnalyticsCollection: boolean;
  allowUsageAnalyticsUpload: boolean;
  allowDetailedDiagnostics: boolean;
};

export type AuditEntry = {
  id: string;
  action: string;
  scope: string | null;
  decision: string;
  sourceWorkflow: string | null;
  createdAt: number;
};

export type ProfileValidation = {
  valid: boolean;
  version: string | null;
  error: string | null;
};

// ─── Runtime Profiles ───

export async function listRuntimeProfiles(): Promise<RuntimeProfile[]> {
  return invoke<RuntimeProfile[]>("list_runtime_profiles");
}

export async function upsertRuntimeProfile(profile: RuntimeProfile): Promise<void> {
  return invoke("upsert_runtime_profile", { profile });
}

export async function deleteRuntimeProfile(id: string): Promise<void> {
  return invoke("delete_runtime_profile", { id });
}

export async function validateRuntimeProfile(profile: RuntimeProfile): Promise<ProfileValidation> {
  return invoke<ProfileValidation>("validate_runtime_profile", { profile });
}

// ─── Defaults ───

export async function getRuntimeDefaults(): Promise<RuntimeDefaults> {
  return invoke<RuntimeDefaults>("get_runtime_defaults");
}

export async function setRuntimeDefaults(defaults: RuntimeDefaults): Promise<void> {
  return invoke("set_runtime_defaults", { defaults });
}

export async function resetRuntimeDefaults(): Promise<void> {
  return invoke("reset_runtime_defaults");
}

// ─── Permissions ───

export async function getPermissionRules(): Promise<PermissionRules> {
  return invoke<PermissionRules>("get_permission_rules");
}

export async function setPermissionRules(rules: PermissionRules): Promise<void> {
  return invoke("set_permission_rules", { rules });
}

export async function resetPermissionRules(): Promise<void> {
  return invoke("reset_permission_rules");
}

// ─── Audit Trail ───

export async function listAuditTrail(limit?: number): Promise<AuditEntry[]> {
  return invoke<AuditEntry[]>("list_audit_trail", { limit: limit ?? 50 });
}

export async function clearAuditTrail(): Promise<void> {
  return invoke("clear_audit_trail");
}
