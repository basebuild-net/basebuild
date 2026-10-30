import { useCallback, useState } from "react";
import type { NativeToolEvent } from "../../../lib/native-chat";
import type { Idea } from "../../../lib/ideas";
import { IdeaBatchPreview, parseIdeaBatch } from "../IdeaReviewWorkbench";
import { formatElapsed } from "./chatFormat";
import { t } from "../../../i18n";
import { formatDateTime } from "../../../i18n/format";

// Module-level expansion state for tool cards. Keyed by tool event id,
// survives re-renders during streaming so a card the user expanded stays
// expanded as the event updates from pending → running → success.
const toolCardExpanded = new Map<string, boolean>();

export function ToolEventCard({
  event,
  onResolveApproval,
  debugMode,
  onSetApprovalMode,
  ideas = [],
  onOpenIdeaBatch,
}: {
  event: NativeToolEvent;
  onResolveApproval?: (decision: "allow" | "allow_session" | "deny") => void;
  debugMode?: boolean;
  onSetApprovalMode?: (mode: "safe" | "balanced" | "auto") => void;
  ideas?: Idea[];
  onOpenIdeaBatch?: (toolId: string) => void;
}) {
  const [expanded, setExpanded] = useState(() => toolCardExpanded.get(event.id) ?? false);
  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      toolCardExpanded.set(event.id, next);
      return next;
    });
  }, [event.id]);

  const isRunning = event.status === "running" || event.status === "pending";
  const isError = event.status === "error" || event.status === "denied";
  const isApproval = event.status === "pending";
  const isCommand = event.kind === "run_command" || event.kind === "command";
  const isEdit = event.kind === "edit_file" || event.kind === "write_file";
  const isMetrics = event.kind === "request_metrics";
  const icon = isApproval ? "🔐" : isCommand ? "▶" : isEdit ? "✎" : isMetrics ? "📊" : "🔧";
  const statusClass = isRunning ? "running" : isError ? "error" : event.status === "success" || event.status === "recorded" || event.status === "allow" ? "success" : "info";
  const showExpanded = expanded || isApproval;

  // Prefer the structured diff field from the backend; fall back to
  // parsing the summary for legacy events that predate the diff column.
  const hasDiff = isEdit && (event.diff != null || /^[+-]/m.test(event.summary));
  const diffText = event.diff ?? (hasDiff ? event.summary : "");
  const diffLines = diffText.split("\n").filter((l) => l.length > 0);

  const timeStr = event.createdAt
    ? formatDateTime(new Date(event.createdAt * 1000), { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  const activeDuration = isRunning && event.createdAt
    ? formatElapsed(Math.max(0, Math.floor(Date.now() / 1000) - event.createdAt))
    : null;

  // Parse arguments for structured display.
  const parsedArgs = (() => {
    if (!event.arguments) return null;
    try {
      return JSON.parse(event.arguments);
    } catch {
      return null;
    }
  })();

  const ideaBatch = event.kind === "propose_ideas" ? parseIdeaBatch(parsedArgs) : null;
  if (ideaBatch) {
    return (
      <IdeaBatchPreview
        {...ideaBatch}
        status={event.status}
        ideas={ideas}
        onOpen={() => onOpenIdeaBatch?.(event.id)}
      />
    );
  }

  // Extract key fields from parsed args depending on tool kind.
  const argDisplay = (() => {
    if (!parsedArgs) return null;
    if (isCommand) {
      const cmd = typeof parsedArgs === "object" && parsedArgs !== null && "command" in parsedArgs
        ? String(parsedArgs.command)
        : null;
      return cmd ? { label: t("toolEventCard.command"), value: cmd } : null;
    }
    if (isEdit) {
      const path = typeof parsedArgs === "object" && parsedArgs !== null && "path" in parsedArgs
        ? String(parsedArgs.path)
        : null;
      return path ? { label: t("toolEventCard.file"), value: path } : null;
    }
    // Generic: look for common fields.
    if (typeof parsedArgs === "object" && parsedArgs !== null) {
      for (const key of ["path", "file", "filePath", "directory", "dir", "pattern", "query", "url", "command"]) {
        if (key in parsedArgs) {
          return { label: key.charAt(0).toUpperCase() + key.slice(1), value: String(parsedArgs[key]) };
        }
      }
    }
    return null;
  })();

  // Approval provenance: how was this tool call decided?
  const provenance = (() => {
    if (!event.decision) return null;
    const dec = event.decision;
    if (dec === "approved") {
      return event.ruleSource ? t("toolEventCard.allowedByRule", { ruleSource: event.ruleSource }) : t("toolEventCard.allowedByUser");
    }
    if (dec === "denied") {
      return event.ruleSource ? t("toolEventCard.deniedByRule", { ruleSource: event.ruleSource }) : t("toolEventCard.deniedByUser");
    }
    if (dec === "auto") return t("toolEventCard.autoApprovedSessionMode");
    if (dec === "pending") return t("toolEventCard.approvalPending");
    return dec;
  })();

  return (
    <div data-tool-id={event.id} className={`tool-card tool-card-${statusClass}${isApproval ? " tool-card-approval" : ""}`} title={t("toolEventCard.text", { kind: event.kind, status: event.status, value: timeStr ? ` at ${timeStr}` : "", value2: provenance ? ` — ${provenance}` : "" })}>
      <div className="tool-card-header" onClick={() => { if (!isApproval) toggleExpanded(); }} role={isApproval ? undefined : "button"} tabIndex={isApproval ? -1 : 0} aria-expanded={isApproval ? undefined : expanded}>
        <span className="tool-card-icon">{icon}</span>
        <span className={`tool-card-name is-${event.kind.replace(/_/g, "-")}`}>{event.kind.replace(/_/g, " ")}</span>
        {argDisplay ? <code className="tool-card-arg-value" title={t("toolEventCard.text2", { label: argDisplay.label, value: argDisplay.value })}>{argDisplay.value}</code> : null}
        <span className={`tool-card-status tool-card-status-${statusClass}`}>
          {event.status}{activeDuration ? t("toolEventCard.text3", { activeDuration: activeDuration }) : ""}
        </span>
        {timeStr ? <span className="tool-card-time text-muted">{timeStr}</span> : null}
        {!isApproval ? <span className="tool-card-expand">{expanded ? "▼" : "▶"}</span> : null}
      </div>
      {showExpanded ? (
        <div className="tool-card-body">
          {argDisplay ? (
            <div className="tool-card-arg-detail" title={t("toolEventCard.passedToThisTool", { label: argDisplay.label })}>
              <span className="tool-card-arg-label">{argDisplay.label}:</span>
              <code className="tool-card-arg-code">{argDisplay.value}</code>
            </div>
          ) : null}
          {parsedArgs ? (
            <div className="tool-card-args-full" title={t("toolEventCard.fullArgumentsJson")}>
              <span className="tool-card-arg-label">{t("toolEventCard.fullArgs")}</span>
              <pre className="tool-card-args-json">{JSON.stringify(parsedArgs, null, 2)}</pre>
            </div>
          ) : null}
          {hasDiff ? (
            <pre className="tool-card-diff" title={t("toolEventCard.unifiedLineDiffAddedRemoved")}>
              {diffLines.map((line, i) => (
                <span key={i} className={line.startsWith("+") ? "diff-add" : line.startsWith("-") ? "diff-del" : "diff-ctx"}>{line}{"\n"}</span>
              ))}
            </pre>
          ) : !isApproval ? (
            <pre className="tool-card-summary">{event.summary}</pre>
          ) : null}
          {provenance ? (
            <div className="tool-card-provenance text-muted text-sm" title={event.ruleSource ? t("toolEventCard.decisionWithRule", { decision: event.decision ?? "", ruleSource: event.ruleSource }) : t("toolEventCard.decision", { decision: event.decision ?? "" })}>
              {provenance}
            </div>
          ) : null}
          {debugMode ? (
            <div className="tool-card-debug" title={t("toolEventCard.rawEventDataDebugMode")}>
              <span className="tool-card-debug-label">{t("toolEventCard.debug")}</span>
              <pre className="tool-card-debug-data">{JSON.stringify(event, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
      {!showExpanded && event.summary ? (
        <div className="tool-card-summary-truncated text-muted text-sm">{event.summary.slice(0, 120)}{event.summary.length > 120 ? "…" : ""}</div>
      ) : null}
      {isApproval && isRunning && onResolveApproval ? (
        <div className="tool-card-actions tool-card-approval-actions">
          <button className="btn btn-sm btn-primary" title={t("toolEventCard.allowThisToolCallOnce")} type="button" onClick={() => onResolveApproval("allow")}>{t("toolEventCard.allowOnce")}</button>
          <button className="btn btn-sm" title={t("toolEventCard.allowAllCallsToThis")} type="button" onClick={() => onResolveApproval("allow_session")}>{t("toolEventCard.allowSession")}</button>
          <button className="btn btn-sm" title={t("toolEventCard.denyThisToolCall")} type="button" onClick={() => onResolveApproval("deny")}>{t("toolEventCard.deny")}</button>
          {onSetApprovalMode ? (
            <button className="btn btn-sm tool-card-allow-all" title={t("toolEventCard.switchToAutoModeAllow")} type="button" onClick={() => onSetApprovalMode("auto")}>{t("toolEventCard.allowAllAuto")}</button>
          ) : null}
        </div>
      ) : null}
      {isApproval && isRunning && !onResolveApproval ? (
        <div className="tool-card-actions text-muted text-sm" title={t("toolEventCard.approvalResolutionIsNotAvailable")}>
          <span>{t("toolEventCard.approvalPendingWaitingForResolution")}</span>
        </div>
      ) : null}
    </div>
  );
}
