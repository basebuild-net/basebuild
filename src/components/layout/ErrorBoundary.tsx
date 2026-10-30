import { Component, type ErrorInfo, type ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { stabilityRecordRendererCrash } from "../../lib/stability";
import { t } from "../../i18n";

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
    return { error, stack: null, source: t("errorBoundary.reactRender") };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const stack = errorInfo.componentStack ?? null;
    this.setState({ stack, source: t("errorBoundary.reactRender") });
    console.error("Basebuild renderer crashed", error, errorInfo);
    this.persist(
      t("errorBoundary.reactRender"),
      error.message || t("errorBoundary.renderError"),
      [error.stack ?? error.message, stack].filter(Boolean).join("\n\nComponent stack:\n" /* i18n-exempt: developer diagnostics */),
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
        error: new Error(t("errorBoundary.rustBackendPanic")),
        stack: event.payload,
        source: t("errorBoundary.rustBackend"),
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
    const error = event.error instanceof Error ? event.error : new Error(event.message || t("errorBoundary.unknownRendererError"));
    this.setState({ error, stack: null, source: t("errorBoundary.windowError") });
    console.error("Basebuild window error", error);
    this.persist(t("errorBoundary.windowError"), error.message || t("errorBoundary.windowError"), error.stack ?? error.message ?? t("errorBoundary.unknownRendererError"));
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason ?? t("errorBoundary.unhandledPromiseRejection")));
    this.setState({ error, stack: null, source: t("errorBoundary.unhandledPromiseRejection") });
    console.error("Basebuild unhandled promise rejection", error);
    this.persist(
      t("errorBoundary.unhandledPromiseRejection"),
      error.message || t("errorBoundary.unhandledRejection"),
      error.stack ?? error.message ?? t("errorBoundary.unhandledPromiseRejection"),
    );
  };

  private copyDetails = async () => {
    const { error, stack, source } = this.state;
    const details = [t("errorBoundary.source", { value1: source ?? t("errorBoundary.unknown") }), error?.stack ?? error?.message ?? t("errorBoundary.unknownRendererError"), stack]
      .filter(Boolean)
      .join("\n\nComponent stack:\n" /* i18n-exempt: developer diagnostics */);
    await navigator.clipboard.writeText(details);
  };

  private reload = () => {
    window.location.reload();
  };


  render() {
    const { error, stack, source } = this.state;

    if (!error) return this.props.children;

    const details = [t("errorBoundary.source2", { value1: source ?? t("errorBoundary.unknown") }), error.stack ?? error.message, stack].filter(Boolean).join("\n\nComponent stack:\n" /* i18n-exempt: developer diagnostics */);

    return (
      <div className="app-container">
        <main className="workspace-scroll">
          <div className="empty-state card">
            <h3>{t("errorBoundary.basebuildHitAProblem")}</h3>
            <p className="text-muted text-sm">
              {t("errorBoundary.renderFailed", { source: source ?? t("errorBoundary.theRenderer") })}
            </p>
            <pre className="pre mono" title={t("errorBoundary.crashDetails")}>{details}</pre>
            <div className="row">
              <button className="btn btn-primary" type="button" title={t("errorBoundary.reloadTheApp")} onClick={this.reload}>
                {t("errorBoundary.reloadApp")}
              </button>
              <button className="btn" type="button" title={t("errorBoundary.copyCrashDetailsToThe")} onClick={() => void this.copyDetails()}>
                {t("errorBoundary.copyErrorDetails")}
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }
}
