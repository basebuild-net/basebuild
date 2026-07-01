import { Plus, TerminalSquare, X } from "lucide-react";
import type { SessionTab } from "../../lib/sessions";

type WorkspaceTabsProps = {
  tabs: SessionTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCreateTerminal: () => void;
  onCreateOmp: () => void;
};

export function WorkspaceTabs({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCreateTerminal,
  onCreateOmp,
}: WorkspaceTabsProps) {
  return (
    <div className="workspace-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`workspace-tab${tab.id === activeTabId ? " is-active" : ""}`}
          type="button"
          title={tab.title}
          onClick={() => onSelectTab(tab.id)}
        >
          <TerminalSquare size={12} />
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
      ))}
      <div className="workspace-tab-actions">
        <button className="btn-icon btn-icon-sm" title="New terminal tab" type="button" onClick={onCreateTerminal}>
          <Plus size={13} />
        </button>
        <button className="btn-icon btn-icon-sm" title="New OMP tab" type="button" onClick={onCreateOmp}>
          <TerminalSquare size={13} />
        </button>
      </div>
    </div>
  );
}
