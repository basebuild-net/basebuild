import { useCallback, useEffect, useState } from "react";
import {
  createPlan as createPlanApi,
  deletePlan as deletePlanApi,
  listPlans,
  setPlanContext as setPlanContextApi,
  setPlanStatus as setPlanStatusApi,
  updatePlan as updatePlanApi,
  type NewPlan,
  type Plan,
  type PlanFocusContext,
  type PlanStatus,
} from "../lib/plans";

export type PlansState = {
  plans: Plan[];
  loading: boolean;
  refreshPlans: () => Promise<void>;
  createPlan: (plan: NewPlan) => Promise<Plan | null>;
  updatePlan: (id: string, patch: NewPlan) => Promise<Plan>;
  setPlanStatus: (id: string, status: PlanStatus) => Promise<Plan>;
  deletePlan: (id: string) => Promise<void>;
  setPlanContext: (id: string, context: PlanFocusContext) => Promise<Plan>;
};


export function usePlans(sessionId: string | null): PlansState {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshPlans = useCallback(async () => {
    if (!sessionId) {
      setPlans([]);
      return;
    }
    setLoading(true);
    try {
      const list = await listPlans(sessionId);
      setPlans(list);
    } catch {
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const createPlan = useCallback(
    async (plan: NewPlan) => {
      if (!sessionId) return null;
      const created = await createPlanApi(sessionId, plan);
      setPlans((prev) => [created, ...prev]);
      return created;
    },
    [sessionId],
  );

  const updatePlan = useCallback(
    async (id: string, patch: NewPlan) => {
      const updated = await updatePlanApi(id, patch);
      setPlans((prev) => prev.map((p) => (p.id === id ? updated : p)));
      return updated;
    },
    [],
  );

  const setPlanStatus = useCallback(
    async (id: string, status: PlanStatus) => {
      const updated = await setPlanStatusApi(id, status);
      setPlans((prev) => prev.map((p) => (p.id === id ? updated : p)));
      return updated;
    },
    [],
  );

  const deletePlan = useCallback(
    async (id: string) => {
      await deletePlanApi(id);
      setPlans((prev) => prev.filter((p) => p.id !== id));
    },
    [],
  );

  const setPlanContext = useCallback(
    async (id: string, context: PlanFocusContext) => {
      const updated = await setPlanContextApi(id, context);
      setPlans((prev) => prev.map((p) => (p.id === id ? updated : p)));
      return updated;
    },
    [],
  );

  useEffect(() => {
    void refreshPlans();
  }, [refreshPlans]);

  return {
    plans,
    loading,
    refreshPlans,
    createPlan,
    updatePlan,
    setPlanStatus,
    deletePlan,
    setPlanContext,
  };
}
