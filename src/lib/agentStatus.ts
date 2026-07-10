import type { PanelStatus } from "../components/panels/PanelStatusContext";

export type AgentStatus = "running" | "standby" | "questioning" | "idle";

/**
 * Derive the project-level agent status from the statuses of its panels.
 * Priority: questioning > running > standby > idle.
 */
export function getProjectAgentStatus(panelStatuses: PanelStatus[]): AgentStatus {
  if (panelStatuses.includes("thinking")) return "questioning";
  if (panelStatuses.includes("streaming") || panelStatuses.includes("running")) return "running";
  if (panelStatuses.some((s) => s === "succeeded" || s === "error")) return "standby";
  if (panelStatuses.length > 0) return "standby";
  return "idle";
}
