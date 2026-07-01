import { Component, type ErrorInfo, type ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, stack: null, source: "React render" };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ stack: errorInfo.componentStack ?? null, source: "React render" });
    console.error("Basebuild renderer crashed", error, errorInfo);
  }

  componentDidMount() {
    window.addEventListener("error", this.handleWindowError);
    window.addEventListener("unhandledrejection", this.handleUnhandledRejection);
    // Listen for Rust panic events emitted from the backend
    listen<string>("rust://panic", (event) => {
      this.setState({
        error: new Error("Rust backend panic"),
        stack: event.payload,
        source: "Rust backend",
      });
      console.error("Basebuild Rust panic", event.payload);
    }).then((fn: UnlistenFn) => { this.unlistenRust = fn; }).catch(() => {});
  }

  private unlistenRust: UnlistenFn | null = null;

  componentWillUnmount() {
    window.removeEventListener("error", this.handleWindowError);
    window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
    this.unlistenRust?.();
  }

  private handleWindowError = (event: ErrorEvent) => {
    const error = event.error instanceof Error ? event.error : new Error(event.message || "Unknown renderer error");
    this.setState({ error, stack: null, source: "Window error" });
    console.error("Basebuild window error", error);
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason ?? "Unhandled promise rejection"));
    this.setState({ error, stack: null, source: "Unhandled promise rejection" });
    console.error("Basebuild unhandled promise rejection", error);
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

  render() {
    const { error, stack, source } = this.state;

    if (!error) return this.props.children;

    const details = [`Source: ${source ?? "Unknown"}`, error.stack ?? error.message, stack].filter(Boolean).join("\n\nComponent stack:\n");

    return (
      <div className="app-container">
        <main className="workspace-scroll">
          <div className="empty-state card">
            <h3>Basebuild renderer crashed</h3>
            <p className="text-muted text-sm">
              {source ?? "Renderer"} failed. Basebuild kept the crash report visible instead of leaving a black window.
              Copy the details below and reload to recover.
            </p>
            <pre className="pre mono" title="Renderer error details">{details}</pre>
            <div className="row">
              <button className="btn btn-primary" type="button" title="Reload the app UI" onClick={this.reload}>
                Reload app
              </button>
              <button className="btn" type="button" title="Copy renderer error details" onClick={() => void this.copyDetails()}>
                Copy error details
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }
}
