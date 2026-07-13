import { useCallback, useEffect, useState } from "react";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { AppShell } from "./components/layout/AppShell";
import { StartupSplash } from "./components/layout/StartupSplash";
import { LogProvider } from "./state/log";
import { useUpdater } from "./state/updater";
import { startupLaunchMode, type LaunchMode } from "./lib/startup";

export default function App() {
  const [splashDone, setSplashDone] = useState(import.meta.env.DEV);
  const updates = useUpdater();
  const [launchMode, setLaunchMode] = useState<LaunchMode>("foreground");

  useEffect(() => {
    void startupLaunchMode()
      .then(setLaunchMode)
      .catch(() => setLaunchMode("foreground"));
  }, []);

  const handleSplashComplete = useCallback(() => {
    setSplashDone(true);
  }, []);

  // For background (autostart) launches, skip the splash entirely — the
  // window is hidden and the updater check runs silently via useUpdater.
  // The user sees the main app when they open the window via tray.
  const skipSplash = import.meta.env.DEV || launchMode === "background";

  return (
    <ErrorBoundary>
      <LogProvider>
        {splashDone || skipSplash ? (
          <AppShell updates={updates} />
        ) : (
          <StartupSplash updates={updates} onComplete={handleSplashComplete} />
        )}
      </LogProvider>
    </ErrorBoundary>
  );
}
