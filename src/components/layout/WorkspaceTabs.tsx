import { useState } from "react";
import { FileText, LayoutTemplate, Plus, TerminalSquare, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SessionTab, TabKind } from "../../lib/sessions";

const kindIcons: Record<TabKind, LucideIcon> = {
  terminal: TerminalSquare,
  file: FileText,
  empty: LayoutTemplate,
};

type WorkspaceTabsProps = {
  tabs: SessionTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCreateTab: (kind: "terminal" | "empty") => void;
};

export function WorkspaceTabs({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCreateTab,
}: WorkspaceTabsProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="workspace-tabs-container">
      <div className="workspace-tabs">
        {tabs.map((tab) => {
          const Icon = kindIcons[tab.kind];
          return (
            <button
              key={tab.id}
              className={`workspace-tab${tab.id === activeTabId ? " is-active" : ""}`}
              type="button"
              title={tab.title}
              onClick={() => onSelectTab(tab.id)}
            >
              <Icon size={12} />
              <span>{tab.title}</span>
              <button
                className="btn-icon workspace-tab-close"
                title="Close tab"
                type="button"
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              >
                <X size={11} />
              </button>
            </button>
          );
        })}
        <div className="workspace-tab-actions">
          <button className="btn-icon btn-icon-sm" title="New tab" type="button" onClick={() => setMenuOpen((v) => !v)}>
            <Plus size={13} />
          </button>
          {menuOpen ? (
            <div className="workspace-tab-add-menu" onMouseLeave={() => setMenuOpen(false)}>
              <button type="button" onClick={() => { onCreateTab("terminal"); setMenuOpen(false); }}>
                <TerminalSquare size={12} /> Terminal
              </button>
              <button type="button" onClick={() => { onCreateTab("empty"); setMenuOpen(false); }}>
                <LayoutTemplate size={12} /> Schematic
              </button>
              <span className="add-menu-hint">Open a file from the Files panel</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
