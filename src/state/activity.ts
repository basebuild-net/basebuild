export type ActivityId = "projects" | "omp" | "terminal" | "source" | "configs" | "updates";

export type ActivityItem = {
  id: ActivityId;
  label: string;
  badge?: number;
};

export const primaryActivities: ActivityItem[] = [
  { id: "projects", label: "Projects" },
  { id: "omp", label: "OMP" },
  { id: "terminal", label: "Terminals" },
  { id: "source", label: "Source" },
  { id: "configs", label: "Configs" },
  { id: "updates", label: "Updates" },
];
