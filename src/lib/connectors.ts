import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ConnectorState =
  | "registered"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"
  | "unsupported";

export type ConnectorTransport = "stdio" | "loopback" | "pty";

export type ConnectorCapability =
  | "command"
  | "file_access"
  | "provider_claim"
  | "chat_sync"
  | "web_bridge"
  | "diagnostics"
  | "analytics"
  | "skills";

export type PermissionDecision = "allow" | "deny" | "ask";

export type ConnectorGrantScope = "once" | "session" | "project";

export interface Connector {
  id: string;
  manifestId: string;
  name: string;
  version: string;
  transport: ConnectorTransport;
  capabilities: ConnectorCapability[];
  state: ConnectorState;
  trusted: boolean;
  enabled: boolean;
  projectPath: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ConnectorManifest {
  id: string;
  name: string;
  version: string;
  transport: ConnectorTransport;
  capabilities: ConnectorCapability[];
  detectCommand: string | null;
  launchCommand: string | null;
  trusted: boolean;
  defaultEnabled: boolean;
}

export interface ConnectorGrantRecord {
  id: string;
  connectorId: string;
  capability: string;
  decision: string;
  scope: string;
  projectPath: string | null;
  createdAt: number;
}

export interface ProviderClaim {
  id: string;
  connectorId: string;
  providerId: string;
  providerLabel: string;
  approved: boolean;
  denied: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ConnectorEvent {
  connectorId: string;
  eventType:
    | "state_changed"
    | "permission_requested"
    | "provider_claimed";
  payload: Record<string, unknown>;
}

export function connectorRegister(manifest: ConnectorManifest): Promise<Connector> {
  return invoke("connector_register", { manifest });
}

export function connectorList(): Promise<Connector[]> {
  return invoke("connector_list");
}

export function connectorGet(id: string): Promise<Connector | null> {
  return invoke("connector_get", { id });
}

export function connectorSetEnabled(id: string, enabled: boolean): Promise<void> {
  return invoke("connector_set_enabled", { id, enabled });
}

export function connectorDelete(id: string): Promise<void> {
  return invoke("connector_delete", { id });
}

export function connectorListGrants(connectorId: string): Promise<ConnectorGrantRecord[]> {
  return invoke("connector_list_grants", { connectorId });
}

export function connectorRevokeGrants(connectorId: string): Promise<void> {
  return invoke("connector_revoke_grants", { connectorId });
}

export function connectorRecordGrant(
  connectorId: string,
  capability: string,
  decision: string,
  scope: string,
): Promise<void> {
  return invoke("connector_record_grant", { connectorId, capability, decision, scope });
}

export function connectorListClaims(connectorId: string): Promise<ProviderClaim[]> {
  return invoke("connector_list_claims", { connectorId });
}

export function connectorApproveClaim(id: string): Promise<void> {
  return invoke("connector_approve_claim", { id });
}

export function connectorDenyClaim(id: string): Promise<void> {
  return invoke("connector_deny_claim", { id });
}

export function onConnectorEvent(
  handler: (event: ConnectorEvent) => void,
): Promise<UnlistenFn> {
  return listen<ConnectorEvent>("connector://event", (e) => handler(e.payload));
}
