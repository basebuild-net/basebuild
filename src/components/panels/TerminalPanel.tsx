import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { TerminalSquare } from "lucide-react";
import { listenTerminalOutput, listTerminals, resizeTerminal, writeTerminal } from "../../lib/terminal";

type TerminalPanelProps = {
  /** Existing terminal ID to connect to. If null, shows empty state. */
  terminalId?: number | null;
  /** Optional: create a new terminal on mount with this cwd (legacy mode). */
  cwd?: string | null;
  /** Called with terminal output data when it arrives. */
  onOutput?: (data: string) => void;
  /** Called when the user clicks Reconnect after a dead session.
   * Parent should create a new terminal and update the panel's terminalId. */
  onReconnect?: () => void;
};

const defaultShell =
  typeof window !== "undefined" && window.navigator.platform.startsWith("Win") ? "powershell.exe" : "bash";

export function TerminalPanel({ terminalId, cwd, onOutput, onReconnect }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Debug state — visible on-screen so no DevTools needed.
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const debugRef = useRef<HTMLDivElement | null>(null);

  function dbg(line: string) {
    const ts = new Date().toLocaleTimeString();
    const entry = `[${ts}] ${line}`;
    setDebugLines((prev) => [...prev.slice(-30), entry]);
    // Also log to console in case DevTools is open.
    console.log("[terminal]", entry);
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

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

      dbg(`init: container=${container.clientWidth}x${container.clientHeight}`);

      const sized = await waitForSize(container);
      if (!sized || disposed || !containerRef.current) {
        dbg("init: waitForSize returned false, aborting");
        return;
      }

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
        /* transient layout error */
      }

      if (disposed) {
        terminal.dispose();
        return;
      }

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      const id = terminalId;
      if (id === null || id === undefined) {
        dbg("init: no terminalId, showing empty state");
        setConnected(false);
        return;
      }

      dbg(`init: terminalId=${id}, checking liveness...`);

      // Check if the terminal session actually exists in the backend.
      try {
        const alive = await listTerminals();
        dbg(`listTerminals: ${alive.length} sessions: ${JSON.stringify(alive.map((t) => `#${t.id}(alive=${t.alive})`))}`);
        if (disposed) return;
        if (!alive.some((t) => t.id === id && t.alive)) {
          dbg(`init: terminal #${id} NOT in alive list — showing reconnect overlay`);
          setConnected(false);
          return;
        }
        dbg(`init: terminal #${id} is alive, connecting...`);
      } catch (e) {
        dbg(`listTerminals failed: ${e}`);
      }

      // Listen for output from this terminal
      const listener = await listenTerminalOutput((event) => {
        dbg(`output event: ${JSON.stringify(event.payload)}`);
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
        dbg(`onData: ${JSON.stringify(data)}`);
        void writeTerminal(id, data)
          .then(() => dbg(`writeTerminal ok: ${JSON.stringify(data)}`))
          .catch((err) => {
            dbg(`writeTerminal FAILED: ${String(err)}`);
            setConnected(false);
            terminal.writeln("\r\n\x1b[31m[terminal closed — click Reconnect]\x1b[0m");
          });
      });

      setConnected(true);
      dbg("connected=true, calling terminal.focus()");

      terminal.focus();

      // Verify the hidden textarea exists and has focus.
      const textarea = containerRef.current?.querySelector(".xterm-helper-textarea") as HTMLTextAreaElement | null;
      if (textarea) {
        dbg(`textarea found: left=${getComputedStyle(textarea).left}, opacity=${getComputedStyle(textarea).opacity}, focused=${document.activeElement === textarea}`);
      } else {
        dbg("WARNING: xterm-helper-textarea NOT found in DOM");
      }

      requestAnimationFrame(() => {
        if (disposed) return;
        try {
          fitAddon.fit();
        } catch {
          /* ignore */
        }
        const dims = fitAddon.proposeDimensions();
        if (dims) void resizeTerminal(id, dims.rows, dims.cols).catch(() => {});
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

  // Auto-scroll debug panel to bottom.
  useEffect(() => {
    if (debugRef.current) {
      debugRef.current.scrollTop = debugRef.current.scrollHeight;
    }
  }, [debugLines]);

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
    <div
      className="terminal-panel"
      onClick={() => terminalRef.current?.focus()}
    >
      <div className="terminal-toolbar">
        <span className="terminal-status">
          {connected ? `● Terminal #${terminalId}` : error ? "Error" : "Connecting..."}
        </span>
        {connected && terminalId != null ? (
          <button
            className="btn btn-sm"
            type="button"
            title="Send 'echo hello' directly to PTY (bypasses xterm keyboard)"
            onClick={() => {
              const id = terminalId!;
              dbg(`TEST: sending 'echo hello\\r' directly to writeTerminal(${id})`);
              void writeTerminal(id, "echo hello\r")
                .then(() => dbg("TEST: writeTerminal('echo hello\\r') ok"))
                .catch((err) => dbg(`TEST: writeTerminal FAILED: ${String(err)}`));
            }}
          >
            Test input
          </button>
        ) : null}
      </div>
      {error ? <div className="terminal-error">{error}</div> : null}
      <div className="terminal-viewport" ref={containerRef} />
      {!connected && !error && terminalId != null ? (
        <div className="terminal-reconnect-overlay">
          <p>Terminal session ended</p>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            title="Create a new terminal session"
            onClick={onReconnect}
          >
            Reconnect
          </button>
        </div>
      ) : null}
      {/* Debug overlay — visible at bottom of terminal panel. */}
      <div className="terminal-debug-panel" ref={debugRef}>
        {debugLines.length === 0 ? (
          <span className="terminal-debug-empty">Waiting for init...</span>
        ) : (
          debugLines.map((line, i) => (
            <div key={i} className="terminal-debug-line">{line}</div>
          ))
        )}
      </div>
    </div>
  );
}
