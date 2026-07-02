import { useCallback, useState } from "react";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { AppShell } from "./components/layout/AppShell";
import { StartupSplash } from "./components/layout/StartupSplash";
import { LogProvider } from "./state/log";
import { useUpdater } from "./state/updater";

export default function App() {
  const [splashDone, setSplashDone] = useState(import.meta.env.DEV);
  const updates = useUpdater();

  const handleSplashComplete = useCallback(() => {
    setSplashDone(true);
  }, []);

  return (
    <ErrorBoundary>
      <LogProvider>
        {splashDone ? (
          <AppShell updates={updates} />
        ) : (
          <StartupSplash updates={updates} onComplete={handleSplashComplete} />
        )}
      </LogProvider>
    </ErrorBoundary>
  );
}
