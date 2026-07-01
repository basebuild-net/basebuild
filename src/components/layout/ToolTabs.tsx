import type { LucideIcon } from "lucide-react";

export type ToolTabId = "terminal" | "source" | "debug";

export type ToolTabItem = { id: ToolTabId; icon: LucideIcon; label: string };

type ToolTabsProps = {
  tabs: ToolTabItem[];
  activeTab: ToolTabId;
  onSelect: (id: ToolTabId) => void;
};

export function ToolTabs({ tabs, activeTab, onSelect }: ToolTabsProps) {
  return (
    <div className="tool-tabs" role="tablist">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            className={`tool-tab${isActive ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.id)}
          >
            <Icon size={12} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
