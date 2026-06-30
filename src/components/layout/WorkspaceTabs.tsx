import { useState, type ReactNode } from "react";
import { Play, Plus, RotateCw } from "lucide-react";

type WorkspaceTabsProps = {
  tabs: TabConfig[];
  active: string;
  onSelect: (id: string) => void;
  actions?: ReactNode;
};

type TabConfig = {
  id: string;
  label: string;
};

export function WorkspaceTabs({ tabs, active, onSelect, actions }: WorkspaceTabsProps) {
  return (
    <div className="workspace-tabs">
      <div className="workspace-tab-list">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`workspace-tab${tab.id === active ? " is-active" : ""}`}
            type="button"
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {actions ? <div className="workspace-tab-actions">{actions}</div> : null}
    </div>
  );
}

type IconButtonProps = {
  icon: typeof Play;
  label: string;
  onClick: () => void;
  variant?: "default" | "accent";
};

export function IconButton({ icon: Icon, label, onClick, variant = "default" }: IconButtonProps) {
  return (
    <button
      className={`icon-button${variant === "accent" ? " is-accent" : ""}`}
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <Icon size={16} />
    </button>
  );
}

export function useWorkspaceTabs(initialTab: string) {
  return useState(initialTab);
}
