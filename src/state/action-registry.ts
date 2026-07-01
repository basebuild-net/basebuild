import { useCallback, useRef } from "react";

export type ActionAvailability = "available" | "disabled" | "hidden";

export type AppAction = {
  id: string;
  label: string;
  title: string;
  availability: () => ActionAvailability;
  handler: () => void;
};

export type ActionRegistry = {
  register: (action: AppAction) => void;
  unregister: (id: string) => void;
  get: (id: string) => AppAction | undefined;
  list: () => AppAction[];
  invoke: (id: string) => boolean;
};

export function useActionRegistry(): ActionRegistry {
  const actionsRef = useRef<Map<string, AppAction>>(new Map());

  const register = useCallback((action: AppAction) => {
    actionsRef.current.set(action.id, action);
  }, []);

  const unregister = useCallback((id: string) => {
    actionsRef.current.delete(id);
  }, []);

  const get = useCallback((id: string) => actionsRef.current.get(id), []);

  const list = useCallback(() => Array.from(actionsRef.current.values()), []);

  const invoke = useCallback((id: string) => {
    const action = actionsRef.current.get(id);
    if (!action) return false;
    if (action.availability() !== "available") return false;
    action.handler();
    return true;
  }, []);

  return { register, unregister, get, list, invoke };
}
