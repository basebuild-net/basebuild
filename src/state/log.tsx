import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type LogLevel = "info" | "warn" | "error";

export type LogEntry = {
  id: number;
  level: LogLevel;
  message: string;
  details?: string;
  timestamp: number;
};

type LogContextValue = {
  logs: LogEntry[];
  addLog: (level: LogLevel, message: string, details?: string) => void;
  clear: () => void;
  hasErrors: boolean;
  hasWarnings: boolean;
  lastEntry: LogEntry | null;
};

let nextId = 1;

const LogContext = createContext<LogContextValue | null>(null);

export function LogProvider({ children }: { children: React.ReactNode }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback((level: LogLevel, message: string, details?: string) => {
    const entry: LogEntry = {
      id: nextId++,
      level,
      message,
      details,
      timestamp: Date.now(),
    };
    setLogs((prev) => [...prev, entry].slice(-500));
    // eslint-disable-next-line no-console
    if (level === "error") console.error(message, details ?? "");
    else if (level === "warn") console.warn(message, details ?? "");
    else console.log(message, details ?? "");
  }, []);

  const clear = useCallback(() => setLogs([]), []);

  const value = useMemo<LogContextValue>(() => {
    return {
      logs,
      addLog,
      clear,
      hasErrors: logs.some((l) => l.level === "error"),
      hasWarnings: logs.some((l) => l.level === "warn"),
      lastEntry: logs[logs.length - 1] ?? null,
    };
  }, [logs, addLog, clear]);

  return <LogContext.Provider value={value}>{children}</LogContext.Provider>;
}

export function useLogs(): LogContextValue {
  const ctx = useContext(LogContext);
  if (!ctx) throw new Error("useLogs must be used within LogProvider");
  return ctx;
}
