import { AppShell } from "./components/layout/AppShell";
import { LogProvider } from "./state/log";

export default function App() {
  return (
    <LogProvider>
      <AppShell />
    </LogProvider>
  );
}
