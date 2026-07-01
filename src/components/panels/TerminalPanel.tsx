import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { listenTerminalOutput, resizeTerminal, writeTerminal } from "../../lib/terminal";

type TerminalPanelProps = {
  /** Existing terminal ID to connect to. If null, shows empty state. */
  terminalId?: number | null;
  /** Optional: create a new terminal on mount with this cwd (legacy mode). */
  cwd?: string | null;
};

const defaultShell =
  typeof window !== "undefined" && window.navigator.platform.startsWith("Win") ? "powershell.exe" : "bash";

export function TerminalPanel({ terminalId, cwd }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    async function init() {
      if (!containerRef.current || disposed) return;

      const terminal = new Terminal({
        cursorBlink: true,
        fontFamily: "JetBrains Mono, Consolas, monospace",
        fontSize: 12,
        theme: {
          background: "#000000",
          foreground: "#ffffff",
          cursor: "#ff5606",
          selectionBackground: "rgba(255, 86, 6, 0.3)",
          black: "#000000",
          red: "#f87171",
          green: "#4ade80",
          yellow: "#facc15",
          blue: "#818cf8",
          magenta: "#c084fc",
          cyan: "#06b6d4",
          white: "#ffffff",
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

      const id = terminalId;
      if (id === null || id === undefined) {
        setConnected(false);
        return;
      }

      // Listen for output from this terminal
      const listener = await listenTerminalOutput((event) => {
        if (event.payload.id === id) {
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
        void writeTerminal(id, data);
      });

      setConnected(true);

      const dims = fitAddon.proposeDimensions();
      if (dims) void resizeTerminal(id, dims.rows, dims.cols);
    }

    void init();

    return () => {
      disposed = true;
      unlisten?.();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      setConnected(false);
    };
  }, [terminalId]);

  useEffect(() => {
    function handleResize() {
      fitAddonRef.current?.fit();
      if (terminalId != null) {
        const dims = fitAddonRef.current?.proposeDimensions();
        if (dims) void resizeTerminal(terminalId, dims.rows, dims.cols);
      }
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [terminalId]);

  if (terminalId == null && !cwd) {
    return (
      <div className="terminal-panel">
        <div className="terminal-toolbar">
          <span className="terminal-status">No terminal</span>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-panel">
      <div className="terminal-toolbar">
        <span className="terminal-status">
          {connected ? `● Terminal #${terminalId}` : error ? "Error" : "Connecting..."}
        </span>
      </div>
      {error ? <div className="terminal-error">{error}</div> : null}
      <div className="terminal-viewport" ref={containerRef} />
    </div>
  );
}
