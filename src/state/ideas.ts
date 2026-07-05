import { useCallback, useEffect, useState } from "react";
import {
  createIdea as createIdeaApi,
  deleteIdea as deleteIdeaApi,
  rejectIdea as rejectIdeaApi,
  ensureDefaultCategories as ensureDefaultCategoriesApi,
  listIdeas,
  promoteIdeas as promoteIdeasApi,
  updateIdeaStatus as updateIdeaStatusApi,
  createCategory as createCategoryApi,
  deleteCategory as deleteCategoryApi,
  listCategories,
  type Idea,
  type IdeaCategory,
  type IdeaStatus,
} from "../lib/ideas";

export function useIdeaState(sessionId: string | null) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [categories, setCategories] = useState<IdeaCategory[]>([]);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setIdeas([]);
      setCategories([]);
      return;
    }
    try {
      const [ideaList, catList] = await Promise.all([listIdeas(sessionId), listCategories(sessionId)]);
      setIdeas(ideaList);
      setCategories(catList);
    } catch {
      setIdeas([]);
      setCategories([]);
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createIdea = useCallback(
    async (title: string, description: string, categoryId?: string) => {
      if (!sessionId) return null;
      const idea = await createIdeaApi(sessionId, title, description, categoryId);
      await refresh();
      return idea;
    },
    [sessionId, refresh],
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
    refresh,
    createIdea,
    updateIdeaStatus,
    rejectIdea,
    removeIdea,
    createCategory,
    removeCategory,
    promoteIdeas,
    ensureDefaultCategories,
  };
}
