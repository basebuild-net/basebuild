import { useState } from "react";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { Copy, Trash2, X } from "lucide-react";
import { useLogs, type LogEntry, type LogLevel } from "../../state/log";
import { ModalPortal } from "../ModalPortal";

const levelBadge: Record<LogLevel, string> = {
  debug: "badge badge-debug",
  info: "badge",
  warn: "badge badge-warn",
  error: "badge badge-error",
};

type LogPanelProps = {
  open: boolean;
  onClose: () => void;
};

export function LogPanel({ open, onClose }: LogPanelProps) {
  const { logs, clear, addLog } = useLogs();
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  useEscapeKey(open, onClose);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const filtered = filter === "all" ? logs : logs.filter((l) => l.level === filter);

  return (
    <ModalPortal>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-log" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Warnings & Errors</h2>
          <div className="row gap-sm">
            <button
              className="btn-icon"
              type="button"
              title="Copy all to clipboard"
              aria-label="Copy all to clipboard"
              onClick={() => void copyAll(logs, () => {
                addLog("info", "Log copied to clipboard");
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              })}
            >
              <Copy size={14} />
            </button>
            <button className="btn-icon" type="button" title="Clear log" aria-label="Clear log" onClick={clear}>
              <Trash2 size={14} />
            </button>
            <button className="btn-icon" type="button" title="Close" aria-label="Close" onClick={onClose}>
              <X size={14} />
            </button>
          </div>
        </div>
        {copied ? <div className="log-copy-toast text-sm text-ok">Copied to clipboard</div> : null}
        <div className="log-filter">
          {(["all", "error", "warn", "info", "debug"] as const).map((f) => (
            <button
              key={f}
              className={`btn btn-sm${filter === f ? " btn-primary" : ""}`}
              type="button"
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="log-list">
          {filtered.length === 0 ? (
            <p className="text-muted text-sm pad">No log entries.</p>
          ) : (
            filtered.map((entry) => <LogRow key={entry.id} entry={entry} />)
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

function formatLogs(logs: LogEntry[]): string {
  return logs
    .map((entry) => {
      const time = new Date(entry.timestamp).toISOString();
      let line = `[${time}] [${entry.level.toUpperCase()}] ${entry.message}`;
      if (entry.details) {
        const details = entry.details.split("\n").map((d) => `    ${d}`).join("\n");
        line += `\n${details}`;
      }
      return line;
    })
    .join("\n\n");
}

async function copyAll(logs: LogEntry[], onDone: () => void): Promise<void> {
  const text = logs.length === 0 ? "No warnings or errors." : formatLogs(logs);
  await navigator.clipboard.writeText(text);
  onDone();
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(entry.timestamp).toLocaleTimeString();
  return (
    <div
      className={`log-row ${entry.level}`}
      role="button"
      tabIndex={0}
      onClick={() => {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
        setExpanded((v) => !v);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setExpanded((v) => !v);
        }
      }}
    >
      <div className="log-row-summary">
        <span className={levelBadge[entry.level]}>{entry.level.toUpperCase()}</span>
        <span className="log-time">{time}</span>
        <span className="log-message">{entry.message}</span>
      </div>
      {expanded && entry.details ? (
        <pre className="log-row-details">{entry.details}</pre>
      ) : null}
    </div>
  );
}
