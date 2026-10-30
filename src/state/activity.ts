import type { LucideIcon } from "lucide-react";

export type ActivityId =
  | "projects"
  | "terminal"
  | "omp"
  | "source"
  | "configs"
  | "updates"
  | "debug";

export type ActivityItem = {
  id: ActivityId;
  label: string;
  icon: LucideIcon;
  badge?: number;
};

