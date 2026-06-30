import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { createTerminal, listenTerminalOutput, resizeTerminal, writeTerminal } from "../../lib/terminal";

const defaultShell =
  typeof window !== "undefined" && window.navigator.platform.startsWith("Win") ? "powershell.exe" : "bash";

type TerminalPanelProps = {
  cwd?: string | null;
};

export function TerminalPanel({ cwd }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    async function init() {
      if (!containerRef.current || disposed) return;

      const terminal = new Terminal({
        cursorBlink: true,
        fontFamily: "Cascadia Code, Consolas, monospace",
        fontSize: 13,
        theme: {
          background: "#0a0a0c",
          foreground: "#e6e6e6",
          cursor: "#d4d4d4",
          selectionBackground: "#303035",
          black: "#0a0a0c",
          red: "#ef4444",
          green: "#22c55e",
          yellow: "#f59e0b",
          blue: "#3b82f6",
          magenta: "#d946ef",
          cyan: "#06b6d4",
          white: "#e6e6e6",
        },
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();

      if (disposed) {
        terminal.dispose();
        return;
      }

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Buffer early output until session ID is known
      const pendingOutput: Array<{ id: number; data: string } | { id: number; kind: "close" }> = [];

      const listener = await listenTerminalOutput((event) => {
        const id = sessionIdRef.current;
        if (id !== null && event.payload.id === id) {
          if (event.payload.kind === "data") {
            terminal.write(event.payload.data);
          } else if (event.payload.kind === "close") {
            terminal.writeln("\r\n[terminal closed]");
          }
        }
      });
      if (disposed) {
        listener();
        terminal.dispose();
        return;
      }
      unlisten = () => listener();

      terminal.onData((data) => {
        const id = sessionIdRef.current;
        if (id !== null) void writeTerminal(id, data);
      });

      try {
        const session = await createTerminal(defaultShell, cwd ?? undefined);
        if (disposed) return;
        sessionIdRef.current = session.id;
        setConnected(true);

        const dims = fitAddon.proposeDimensions();
        if (dims) void resizeTerminal(session.id, dims.rows, dims.cols);
      } catch (err) {
        if (!disposed) setError(String(err));
      }
    }

    void init();

    return () => {
      disposed = true;
      unlisten?.();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [cwd]);

  useEffect(() => {
    function handleResize() {
      fitAddonRef.current?.fit();
      const dims = fitAddonRef.current?.proposeDimensions();
      const id = sessionIdRef.current;
      if (id !== null && dims) void resizeTerminal(id, dims.rows, dims.cols);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="terminal-panel">
      <div className="terminal-toolbar">
        <span className="text-muted text-sm">{defaultShell}</span>
        <span className={`text-sm ${connected ? "text-ok" : "text-muted"}`}>
          {error ? "Error" : connected ? "Connected" : "Starting…"}
        </span>
      </div>
      {error ? <div className="terminal-error">{error}</div> : null}
      <div className="terminal-viewport" ref={containerRef} />
    </div>
  );
}
