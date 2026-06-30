import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ToolId } from "./AppShell";

export type ToolItem = { id: ToolId; icon: LucideIcon; label: string; tooltip: string };

type ToolRailProps = {
  tools: ToolItem[];
  activeTool: ToolId;
  onSelectTool: (id: ToolId) => void;
  badge?: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

export function ToolRail({
  tools,
  activeTool,
  onSelectTool,
  badge,
  collapsed,
  onToggleCollapse,
}: ToolRailProps) {
  return (
    <aside className="tool-rail" aria-label="Tools">
      <div className="tool-rail-header">
        <button
          className="btn-icon"
          title={collapsed ? "Expand tool rail" : "Collapse tool rail"}
          aria-label={collapsed ? "Expand tool rail" : "Collapse tool rail"}
          type="button"
          onClick={onToggleCollapse}
        >
          {collapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>
      {tools.map((tool) => {
        const Icon = tool.icon;
        const isActive = tool.id === activeTool;
        const showBadge = badge !== undefined && tool.id === activeTool;
        return (
          <button
            key={tool.id}
            className={`tool-button${isActive ? " is-active" : ""}`}
            type="button"
            title={tool.tooltip}
            aria-label={tool.label}
            onClick={() => onSelectTool(tool.id)}
          >
            <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
            <span className="tool-label">{tool.label}</span>
            {showBadge ? <span className="tool-badge">{badge}</span> : null}
          </button>
        );
      })}
    </aside>
  );
}
