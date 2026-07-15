import { invoke } from "@tauri-apps/api/core";

export type IdeaStatus = "concept" | "picked" | "rejected" | "archived";

export type IdeaCategory = {
  id: string;
  sessionId: string;
  name: string;
  description: string;
  createdAt: number;
};

export type Idea = {
  id: string;
  sessionId: string;
  categoryId: string | null;
  title: string;
  description: string;
  status: IdeaStatus;
  grounding: string;
  anchor: string | null;
  batchId: string | null;
  createdAt: number;
  updatedAt: number;
};

export async function createCategory(sessionId: string, name: string, description: string): Promise<IdeaCategory> {
  return invoke<IdeaCategory>("create_category", { sessionId, name, description });
}

export async function listCategories(sessionId: string): Promise<IdeaCategory[]> {
  return invoke<IdeaCategory[]>("list_categories", { sessionId });
}

export async function listProjectCategories(projectPath: string): Promise<IdeaCategory[]> {
  return invoke<IdeaCategory[]>("list_project_categories", { projectPath });
}

export async function deleteCategory(id: string): Promise<void> {
  return invoke("delete_category", { id });
}

export async function createIdea(
  sessionId: string,
  title: string,
  description: string,
  categoryId?: string,
  grounding?: string,
  anchor?: string,
): Promise<Idea> {
  return invoke<Idea>("create_idea", {
    sessionId,
    title,
    description,
    categoryId: categoryId ?? null,
    grounding: grounding ?? "",
    anchor: anchor ?? null,
  });
}

export async function listIdeas(sessionId: string): Promise<Idea[]> {
  return invoke<Idea[]>("list_ideas", { sessionId });
}

export async function listProjectIdeas(projectPath: string): Promise<Idea[]> {
  return invoke<Idea[]>("list_project_ideas", { projectPath });
}

export async function updateIdea(
  id: string,
  title: string,
  description: string,
  categoryId: string | null,
): Promise<Idea> {
  return invoke<Idea>("update_idea", { id, title, description, categoryId });
}

export async function updateIdeaStatus(id: string, status: IdeaStatus): Promise<void> {
  return invoke("update_idea_status", { id, status });
}

export async function deleteIdea(id: string): Promise<void> {
  return invoke("delete_idea", { id });
}

export async function rejectIdea(id: string): Promise<void> {
  return invoke("reject_idea", { id });
}

export async function ensureDefaultCategories(sessionId: string): Promise<void> {
  return invoke("ensure_default_categories", { sessionId });
}


export type PromoteIdeasInput = {
  sessionId: string;
  ideaIds: string[];
};

export type PromotedPlan = {
  id: string;
  sessionId: string;
  referenceId: string;
  title: string;
  description: string;
  goal: string | null;
  status: string;
  priority: number;
  tags: string[];
  aiEnhanced: boolean;
  context: unknown;
  ideaId?: string;
  changeName?: string;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
};

export async function promoteIdeas(sessionId: string, ideaIds: string[]): Promise<PromotedPlan[]> {
  return invoke<PromotedPlan[]>("promote_ideas", { input: { sessionId, ideaIds } });
}
