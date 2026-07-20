import { Component, type ErrorInfo, type ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { restartApp } from "../../lib/app";
import { stabilityRecordRendererCrash } from "../../lib/stability";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
  stack: string | null;
  source: string | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, stack: null, source: null };
  private unlistenRust: UnlistenFn | null = null;
  /** Guard so a single crash is persisted once, even when several handlers
   *  (getDerivedStateFromError + componentDidCatch, or repeated events) fire. */
  private recorded = false;

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, stack: null, source: "React render" };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const stack = errorInfo.componentStack ?? null;
    this.setState({ stack, source: "React render" });
    console.error("Basebuild renderer crashed", error, errorInfo);
    this.persist(
      "React render",
      error.message || "Render error",
      [error.stack ?? error.message, stack].filter(Boolean).join("\n\nComponent stack:\n"),
    );
  }

  componentDidMount() {
    window.addEventListener("error", this.handleWindowError);
    window.addEventListener("unhandledrejection", this.handleUnhandledRejection);
    // Listen for Rust panic events emitted from the backend. Rust panics are
    // already persisted by the backend panic hook, so we only surface them
    // here (no second report).
    listen<string>("rust://panic", (event) => {
      this.setState({
        error: new Error("Rust backend panic"),
        stack: event.payload,
        source: "Rust backend",
      });
      console.error("Basebuild Rust panic", event.payload);
    })
      .then((fn: UnlistenFn) => {
        this.unlistenRust = fn;
      })
      .catch(() => {});
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.handleWindowError);
    window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
    this.unlistenRust?.();
  }

  /** Persist a renderer crash once so it survives recovery and lands in the
   *  Debug panel. Best-effort — a failed write never blocks recovery. */
  private persist(source: string, message: string, details: string) {
    if (this.recorded) return;
    this.recorded = true;
    void stabilityRecordRendererCrash(source, message, details).catch(() => {});
  }

  private handleWindowError = (event: ErrorEvent) => {
    const error = event.error instanceof Error ? event.error : new Error(event.message || "Unknown renderer error");
    this.setState({ error, stack: null, source: "Window error" });
    console.error("Basebuild window error", error);
    this.persist("Window error", error.message || "Window error", error.stack ?? error.message ?? "Unknown renderer error");
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason ?? "Unhandled promise rejection"));
    this.setState({ error, stack: null, source: "Unhandled promise rejection" });
    console.error("Basebuild unhandled promise rejection", error);
    this.persist(
      "Unhandled promise rejection",
      error.message || "Unhandled rejection",
      error.stack ?? error.message ?? "Unhandled promise rejection",
    );
  };

  private copyDetails = async () => {
    const { error, stack, source } = this.state;
    const details = [`Source: ${source ?? "Unknown"}`, error?.stack ?? error?.message ?? "Unknown renderer error", stack]
      .filter(Boolean)
      .join("\n\nComponent stack:\n");
    await navigator.clipboard.writeText(details);
  };

  private reload = () => {
    window.location.reload();
  };

  private restart = () => {
    void restartApp().catch(() => {});
  };

  render() {
    const { error, stack, source } = this.state;

    if (!error) return this.props.children;

    const details = [`Source: ${source ?? "Unknown"}`, error.stack ?? error.message, stack].filter(Boolean).join("\n\nComponent stack:\n");

    return (
      <div className="app-container">
        <main className="workspace-scroll">
          <div className="empty-state card">
            <h3>Basebuild hit a problem</h3>
            <p className="text-muted text-sm">
              {source ?? "The renderer"} failed. Basebuild kept this recovery screen visible instead of leaving a
              black window, and saved a crash report you can review later under Debug. Reload first; if that does not
              recover, restart Basebuild.
            </p>
            <pre className="pre mono" title="Crash details">{details}</pre>
            <div className="row">
              <button className="btn btn-primary" type="button" title="Reload the app UI without restarting the process" onClick={this.reload}>
                Reload app
              </button>
              <button className="btn" type="button" title="Fully restart Basebuild — use if reloading does not recover" onClick={this.restart}>
                Restart Basebuild
              </button>
              <button className="btn" type="button" title="Copy crash details to the clipboard" onClick={() => void this.copyDetails()}>
                Copy error details
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }
}
