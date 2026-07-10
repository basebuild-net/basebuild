import type { PanelStatus } from "../components/panels/PanelStatusContext";

export type AgentStatus = "running" | "standby" | "questioning" | "idle";

/**
 * Derive the project-level agent status from the statuses of its panels.
 * Priority: questioning > running > standby > idle.
 *
 * - `asking` (pending ask_user interaction) → questioning
 * - `streaming`/`thinking`/`running` (turn in flight) → running
 * - any panels present but none active → standby
 * - no panels → idle
 */
export function getProjectAgentStatus(panelStatuses: PanelStatus[]): AgentStatus {
  if (panelStatuses.includes("asking")) return "questioning";
  if (panelStatuses.some((s) => s === "streaming" || s === "thinking" || s === "running")) return "running";
  if (panelStatuses.length > 0) return "standby";
  return "idle";
}
