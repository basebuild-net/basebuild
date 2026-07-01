import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { AppShell } from "./components/layout/AppShell";
import { LogProvider } from "./state/log";

export default function App() {
  return (
    <ErrorBoundary>
      <LogProvider>
        <AppShell />
      </LogProvider>
    </ErrorBoundary>
  );
}
