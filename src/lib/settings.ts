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
  gitAiProviderId?: string | null;
  gitAiModelId?: string | null;
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

// ─── Approval Gateway ───

export type ApprovalMode = "safe" | "balanced" | "auto";

export type ApprovalRule = {
  id: string;
  projectPath: string;
  toolName: string;
  commandPrefix: string | null;
  decision: PermissionDecision;
  createdAt: number;
};

export async function getApprovalMode(projectPath: string): Promise<ApprovalMode> {
  return invoke<ApprovalMode>("get_approval_mode", { projectPath });
}

export async function setApprovalMode(projectPath: string, mode: ApprovalMode): Promise<void> {
  return invoke("set_approval_mode", { projectPath, mode });
}

export async function listApprovalRules(projectPath: string): Promise<ApprovalRule[]> {
  return invoke<ApprovalRule[]>("list_approval_rules", { projectPath });
}

export async function addApprovalRule(rule: ApprovalRule): Promise<void> {
  return invoke("add_approval_rule", { rule });
}

export async function removeApprovalRule(id: string): Promise<void> {
  return invoke("remove_approval_rule", { id });
}

export async function getMilestoneAutoCommit(projectPath: string): Promise<boolean> {
  return invoke<boolean>("get_milestone_auto_commit", { projectPath });
}

export async function setMilestoneAutoCommit(projectPath: string, enabled: boolean): Promise<void> {
  return invoke("set_milestone_auto_commit", { projectPath, enabled });
}
