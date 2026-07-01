import { Plus, TerminalSquare, X } from "lucide-react";
import type { SessionTab } from "../../lib/sessions";
import { AutonomousToolbar, type AutoMode } from "../terminal/AutonomousToolbar";

type WorkspaceTabsProps = {
  tabs: SessionTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCreateTerminal: () => void;
  autoMode: AutoMode;
  autoCommit: boolean;
  autoPr: boolean;
  autoGroupPr: boolean;
  autoAgents: number;
  onModeChange: (mode: AutoMode) => void;
  onCommitChange: (v: boolean) => void;
  onPrChange: (v: boolean) => void;
  onGroupPrChange: (v: boolean) => void;
  onAgentsChange: (n: number) => void;
  onStop: () => void;
};

export function WorkspaceTabs({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCreateTerminal,
  autoMode,
  autoCommit,
  autoPr,
  autoGroupPr,
  autoAgents,
  onModeChange,
  onCommitChange,
  onPrChange,
  onGroupPrChange,
  onAgentsChange,
  onStop,
}: WorkspaceTabsProps) {
  return (
    <div className="workspace-tabs-container">
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
        </div>
      </div>
      <AutonomousToolbar
        autoMode={autoMode}
        autoCommit={autoCommit}
        autoPr={autoPr}
        autoGroupPr={autoGroupPr}
        autoAgents={autoAgents}
        onModeChange={onModeChange}
        onCommitChange={onCommitChange}
        onPrChange={onPrChange}
        onGroupPrChange={onGroupPrChange}
        onAgentsChange={onAgentsChange}
        onStop={onStop}
      />
    </div>
  );
}
