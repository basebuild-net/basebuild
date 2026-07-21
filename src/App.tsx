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

  // Remove the startup transition suppression class once React has mounted
  // and the shell is ready to paint. The bootstrap script in index.html
  // adds this class to prevent theme flash during initial load.
  useEffect(() => {
    const root = document.documentElement;
    // Use a microtask to ensure one paint cycle has occurred.
    const timer = setTimeout(() => {
      root.classList.remove("bb-suppress-transitions");
      // Tear down the pre-React boot layer now that the shell has mounted.
      const boot = document.getElementById("bb-boot");
      if (boot) {
        boot.classList.add("bb-boot-hide");
        window.setTimeout(() => boot.remove(), 220);
      }
    }, 0);
    return () => clearTimeout(timer);
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
