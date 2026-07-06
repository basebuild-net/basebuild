import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/** Live status of a panel, published by each panel leaf and consumed by the
 *  activity sidebar to render the indicator dot + animation. */
export type PanelStatus =
  | "idle"
  | "streaming"
  | "thinking"
  | "running"
  | "error"
  | "succeeded";

export type PanelStatusEntry = {
  status: PanelStatus;
  /** Epoch ms of the last status change. */
  since: number;
};

type PanelStatusMap = Record<string, PanelStatusEntry>;

type PanelStatusContextValue = {
  statuses: PanelStatusMap;
  setStatus: (panelId: string, status: PanelStatus) => void;
  getStatus: (panelId: string) => PanelStatus;
};

const defaultContext: PanelStatusContextValue = {
  statuses: {},
  setStatus: () => {},
  getStatus: () => "idle",
};

const PanelStatusContext = createContext<PanelStatusContextValue>(defaultContext);

export function PanelStatusProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatuses] = useState<PanelStatusMap>({});

  const value = useMemo<PanelStatusContextValue>(() => ({
    statuses,
    setStatus: (panelId: string, status: PanelStatus) => {
      setStatuses((prev) => ({
        ...prev,
        [panelId]: { status, since: Date.now() },
      }));
    },
    getStatus: (panelId: string): PanelStatus => {
      return statuses[panelId]?.status ?? "idle";
    },
  }), [statuses]);

  return (
    <PanelStatusContext.Provider value={value}>
      {children}
    </PanelStatusContext.Provider>
  );
}

export function usePanelStatus() {
  return useContext(PanelStatusContext);
}

/** Hook for a panel leaf to publish its status. Returns a setter. */
export function usePanelStatusPublisher(panelId: string) {
  const ctx = useContext(PanelStatusContext);
  return (status: PanelStatus) => ctx.setStatus(panelId, status);
}
