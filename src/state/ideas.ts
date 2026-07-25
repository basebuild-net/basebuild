import { useCallback, useEffect, useState } from "react";
import {
  createIdea as createIdeaApi,
  deleteIdea as deleteIdeaApi,
  rejectIdea as rejectIdeaApi,
  ensureDefaultCategories as ensureDefaultCategoriesApi,
  listIdeas,
  listProjectIdeas,
  promoteIdeas as promoteIdeasApi,
  updateIdea as updateIdeaApi,
  updateIdeaStatus as updateIdeaStatusApi,
  createCategory as createCategoryApi,
  deleteCategory as deleteCategoryApi,
  listCategories,
  listProjectCategories,
  type Idea,
  type IdeaCategory,
  type IdeaStatus,
} from "../lib/ideas";
import { usePlanningEvents } from "./planningEvents";

export type IdeaStateValue = {
  ideas: Idea[];
  categories: IdeaCategory[];
  /** True until the first fetch settles. Consumers MUST render a loading
   * state rather than their empty state while this is set. */
  loading: boolean;
  refresh: () => Promise<void>;
  createIdea: (title: string, description: string, categoryId?: string) => Promise<Idea | null>;
  updateIdea: (id: string, title: string, description: string, categoryId: string | null) => Promise<Idea>;
  updateIdeaStatus: (id: string, status: IdeaStatus) => Promise<void>;
  rejectIdea: (id: string) => Promise<void>;
  removeIdea: (id: string) => Promise<void>;
  createCategory: (name: string, description: string) => Promise<IdeaCategory | null>;
  removeCategory: (id: string) => Promise<void>;
  promoteIdeas: (ideaIds: string[]) => Promise<void>;
  ensureDefaultCategories: () => Promise<void>;
};

export function useIdeaState(sessionId: string | null, projectPath?: string | null): IdeaStateValue {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [categories, setCategories] = useState<IdeaCategory[]>([]);
  // Starts true: the first render happens before the mount effect resolves,
  // and consumers rendered "No ideas yet" during it.
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!projectPath && !sessionId) {
      setIdeas([]);
      setCategories([]);
      setLoading(false);
      return;
    }
    try {
      const [ideaList, catList] = projectPath
        ? await Promise.all([
            listProjectIdeas(projectPath),
            listProjectCategories(projectPath),
          ])
        : await Promise.all([listIdeas(sessionId!), listCategories(sessionId!)]);
      setIdeas(ideaList);
      setCategories(catList);
    } catch {
      setIdeas([]);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, [projectPath, sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live refresh: subscribe to planning events so ideas/categories update
  // when captured or status-changed from any surface (including generation
  // turns). Seq-gap detection triggers a full refetch.
  usePlanningEvents(refresh);

  const createIdea = useCallback(
    async (title: string, description: string, categoryId?: string) => {
      if (!sessionId) return null;
      const idea = await createIdeaApi(sessionId, title, description, categoryId);
      await refresh();
      return idea;
    },
    [sessionId, refresh],
  );

  const updateIdea = useCallback(
    async (id: string, title: string, description: string, categoryId: string | null) => {
      const idea = await updateIdeaApi(id, title, description, categoryId);
      await refresh();
      return idea;
    },
    [refresh],
  );

  const updateIdeaStatus = useCallback(
    async (id: string, status: IdeaStatus) => {
      await updateIdeaStatusApi(id, status);
      await refresh();
    },
    [refresh],
  );

  const removeIdea = useCallback(
    async (id: string) => {
      await deleteIdeaApi(id);
      await refresh();
    },
    [refresh],
  );

  const createCategory = useCallback(
    async (name: string, description: string) => {
      if (!sessionId) return null;
      const cat = await createCategoryApi(sessionId, name, description);
      await refresh();
      return cat;
    },
    [sessionId, refresh],
  );

  const removeCategory = useCallback(
    async (id: string) => {
      await deleteCategoryApi(id);
      await refresh();
    },
    [refresh],
  );

  const promoteIdeas = useCallback(
    async (ideaIds: string[]) => {
      if (!sessionId || ideaIds.length === 0) return;
      await promoteIdeasApi(sessionId, ideaIds);
      await refresh();
    },
    [sessionId, refresh],
  );

  const rejectIdea = useCallback(
    async (id: string) => {
      await rejectIdeaApi(id);
      await refresh();
    },
    [refresh],
  );

  const ensureDefaultCategories = useCallback(
    async () => {
      if (!sessionId) return;
      await ensureDefaultCategoriesApi(sessionId);
      await refresh();
    },
    [sessionId, refresh],
  );

  return {
    ideas,
    categories,
    loading,
    refresh,
    createIdea,
    updateIdea,
    updateIdeaStatus,
    rejectIdea,
    removeIdea,
    createCategory,
    removeCategory,
    promoteIdeas,
    ensureDefaultCategories,
  };
}
