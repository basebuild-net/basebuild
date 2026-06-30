import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { createTerminal, listenTerminalOutput, resizeTerminal, writeTerminal } from "../../lib/terminal";

const defaultShell = typeof window !== "undefined" && window.navigator.platform.startsWith("Win")
  ? "powershell.exe"
  : "bash";

export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  const [, forceRender] = useState(0);

  function setSessionId(id: number | null) {
    sessionIdRef.current = id;
    forceRender((n) => n + 1);
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function init() {
      if (!containerRef.current) {
        return;
      }

      const terminal = new Terminal({
        cursorBlink: true,
        fontFamily: "JetBrains Mono, Cascadia Code, Consolas, monospace",
        fontSize: 14,
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

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      terminal.onData((data) => {
        const id = sessionIdRef.current;
        if (id === null) {
          return;
        }
        void writeTerminal(id, data);
      });

      const listener = await listenTerminalOutput((event) => {
        if (event.payload.id !== sessionIdRef.current) {
          return;
        }
        if (event.payload.kind === "data") {
          terminal.write(event.payload.data);
        } else if (event.payload.kind === "close") {
          terminal.writeln("\r\n[terminal closed]");
        }
      });
      unlisten = () => listener();

      const session = await createTerminal(defaultShell);
      setSessionId(session.id);

      const dimensions = fitAddon.proposeDimensions();
      if (dimensions) {
        void resizeTerminal(session.id, dimensions.rows, dimensions.cols);
      }
    }

    void init();

    return () => {
      unlisten?.();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    function handleResize() {
      fitAddonRef.current?.fit();
      const dimensions = fitAddonRef.current?.proposeDimensions();
      const id = sessionIdRef.current;
      if (id !== null && dimensions) {
        void resizeTerminal(id, dimensions.rows, dimensions.cols);
      }
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="terminal-panel">
      <div className="terminal-toolbar">
        <span className="terminal-shell">{defaultShell}</span>
        <span className="terminal-status">{sessionIdRef.current !== null ? "Connected" : "Starting…"}</span>
      </div>
      <div className="terminal-viewport" ref={containerRef} />
    </div>
  );
}
