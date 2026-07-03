import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { TerminalSquare } from "lucide-react";
import { listenTerminalOutput, resizeTerminal, writeTerminal } from "../../lib/terminal";

type TerminalPanelProps = {
  /** Existing terminal ID to connect to. If null, shows empty state. */
  terminalId?: number | null;
  /** Optional: create a new terminal on mount with this cwd (legacy mode). */
  cwd?: string | null;
  /** Called with terminal output data when it arrives. */
  onOutput?: (data: string) => void;
};

const defaultShell =
  typeof window !== "undefined" && window.navigator.platform.startsWith("Win") ? "powershell.exe" : "bash";

export function TerminalPanel({ terminalId, cwd, onOutput }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    // Resolve once the container has a non-zero size. Opening xterm on a
    // zero-size element crashes its viewport (`syncScrollArea` reads undefined
    // render dimensions). This also protects against mounting a terminal in a
    // collapsed/hidden panel.
    function waitForSize(el: HTMLElement): Promise<boolean> {
      return new Promise((resolve) => {
        if (el.clientWidth > 0 && el.clientHeight > 0) {
          resolve(true);
          return;
        }
        const observer = new ResizeObserver(() => {
          if (disposed) {
            observer.disconnect();
            resolve(false);
          } else if (el.clientWidth > 0 && el.clientHeight > 0) {
            observer.disconnect();
            resolve(true);
          }
        });
        observer.observe(el);
      });
    }

    async function init() {
      const container = containerRef.current;
      if (!container || disposed) return;

      const sized = await waitForSize(container);
      if (!sized || disposed || !containerRef.current) return;

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
      try {
        fitAddon.fit();
      } catch {
        /* transient layout error; the resize handler + rAF refit will size it */
      }

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
            if (onOutput) onOutput(event.payload.data);
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

      // rAF refit once layout has settled (fixes the mount-time zero-size race
      // in flex-wrapped containers such as the OMP tab).
      requestAnimationFrame(() => {
        if (disposed) return;
        try {
          fitAddon.fit();
        } catch {
          /* ignore transient layout errors */
        }
        const dims = fitAddon.proposeDimensions();
        if (dims) void resizeTerminal(id, dims.rows, dims.cols);
      });
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
      try {
        fitAddonRef.current?.fit();
      } catch {
        return;
      }
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
      <div className="empty-state">
        <TerminalSquare size={32} className="text-muted" />
        <h3>No terminal</h3>
        <p>Create a terminal tab from the + menu to start a shell.</p>
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
