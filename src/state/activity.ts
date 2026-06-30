import {
  FolderOpen,
  TerminalSquare,
  Bot,
  GitBranch,
  Settings2,
  RefreshCw,
  Bug,
  type LucideIcon,
} from "lucide-react";

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

export const primaryActivities: ActivityItem[] = [
  { id: "projects", label: "Projects", icon: FolderOpen },
  { id: "terminal", label: "Terminal", icon: TerminalSquare },
  { id: "omp", label: "OMP", icon: Bot },
  { id: "source", label: "Source", icon: GitBranch },
  { id: "configs", label: "Configs", icon: Settings2 },
  { id: "updates", label: "Updates", icon: RefreshCw },
  { id: "debug", label: "Debug", icon: Bug },
];
