import { invoke } from "@tauri-apps/api/core";

export type IdeaStatus = "concept" | "planReady" | "inProgress" | "finished" | "paused" | "cancelled";

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
  createdAt: number;
  updatedAt: number;
};

export async function createCategory(sessionId: string, name: string, description: string): Promise<IdeaCategory> {
  return invoke<IdeaCategory>("create_category", { sessionId, name, description });
}

export async function listCategories(sessionId: string): Promise<IdeaCategory[]> {
  return invoke<IdeaCategory[]>("list_categories", { sessionId });
}

export async function deleteCategory(id: string): Promise<void> {
  return invoke("delete_category", { id });
}

export async function createIdea(sessionId: string, title: string, description: string, categoryId?: string): Promise<Idea> {
  return invoke<Idea>("create_idea", { sessionId, title, description, categoryId: categoryId ?? null });
}

export async function listIdeas(sessionId: string): Promise<Idea[]> {
  return invoke<Idea[]>("list_ideas", { sessionId });
}

export async function updateIdeaStatus(id: string, status: IdeaStatus): Promise<void> {
  return invoke("update_idea_status", { id, status });
}

export async function deleteIdea(id: string): Promise<void> {
  return invoke("delete_idea", { id });
}
