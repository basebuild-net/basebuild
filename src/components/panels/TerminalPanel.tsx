import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { TerminalSquare } from "lucide-react";
import { listenTerminalOutput, listTerminals, resizeTerminal, terminalReplay, writeTerminal } from "../../lib/terminal";

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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    function waitForSize(el: HTMLElement): Promise<boolean> {
      const { promise, resolve } = Promise.withResolvers<boolean>();
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        resolve(true);
        return promise;
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
      return promise;
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
          background: "#101211",
          foreground: "#eef2ef",
          cursor: "#6ea97a",
          selectionBackground: "rgba(110, 169, 122, 0.3)",
          black: "#0c0e0d",
          red: "#cf7373",
          green: "#6ea97a",
          yellow: "#d0a04a",
          blue: "#b8c0ba",
          magenta: "#98a19a",
          cyan: "#b8c0ba",
          white: "#eef2ef",
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
        setConnected(false);
        return;
      }

      // Check if the terminal session actually exists in the backend.
      try {
        const alive = await listTerminals();
        if (disposed) return;
        if (!alive.some((t) => t.id === id && t.alive)) {
          setConnected(false);
          return;
        }
      } catch (e) {
        setError(String(e));
      }

      // Track the last seq we've seen to deduplicate replayed bytes
      // against live events that arrive during replay.
      let lastSeenSeq = 0;

      // Listen for output from this terminal BEFORE requesting replay
      // to avoid a race window where bytes arrive between replay and
      // listener registration.
      const listener = await listenTerminalOutput((event) => {
        if (event.payload.id !== id) return;
        if (event.payload.kind === "data") {
          const seq = event.payload.seq;
          // Drop live events that were already captured in the replay
          // buffer (seq <= lastSeenSeq means they're in the replay).
          if (seq !== undefined && seq <= lastSeenSeq) return;
          if (seq !== undefined) lastSeenSeq = seq;
          terminal.write(event.payload.data);
          if (onOutput) onOutput(event.payload.data);
        } else if (event.payload.kind === "close") {
          terminal.writeln("\r\n[terminal closed]");
          setConnected(false);
        }
      });
      if (disposed) {
        listener();
        terminal.dispose();
        return;
      }
      unlisten = () => listener();

      // Request scrollback replay after listener is registered.
      // This catches the shell startup prompt that was produced
      // before the listener attached.
      try {
        const replay = await terminalReplay(id);
        if (disposed) return;
        if (replay.data) {
          terminal.write(replay.data);
          lastSeenSeq = replay.lastSeq;
        }
      } catch {
        // Replay is best-effort; live events will still flow.
      }

      terminal.onData((data) => {
        void writeTerminal(id, data).catch(() => {
          setConnected(false);
          terminal.writeln("\r\n\x1b[31m[terminal closed — click Reconnect]\x1b[0m");
        });
      });

      setConnected(true);
      terminal.focus();

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
    let rafId: number | null = null;
    let observer: ResizeObserver | null = null;

    const handleResize = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!fitAddonRef.current || !terminalRef.current) return;
        try {
          fitAddonRef.current.fit();
        } catch {
          /* transient layout error */
        }
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims && terminalId != null) {
          void resizeTerminal(terminalId, dims.rows, dims.cols).catch(() => {});
        }
      });
    };

    // ResizeObserver catches split, sidebar, scale, and container changes
    // that window-only resize misses.
    if (containerRef.current) {
      observer = new ResizeObserver(handleResize);
      observer.observe(containerRef.current);
    }
    window.addEventListener("resize", handleResize);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
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
    <div
      className="terminal-panel"
      onClick={() => terminalRef.current?.focus()}
    >
      <div className="terminal-toolbar">
        <span className="terminal-status">
          {connected ? `● Terminal #${terminalId}` : error ? "Error" : "Connecting..."}
        </span>
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
    </div>
  );
}
