import { useState } from "react";
import { FileText, LayoutTemplate, MessageSquare, Plus, TerminalSquare, X, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SessionTab, TabKind } from "../../lib/sessions";

const kindIcons: Record<TabKind, LucideIcon> = {
  terminal: TerminalSquare,
  file: FileText,
  empty: LayoutTemplate,
  chat: MessageSquare,
  omp: Zap,
};

type WorkspaceTabsProps = {
  tabs: SessionTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCreateTab: (kind: "terminal" | "empty" | "chat" | "omp") => void;
  /** Whether OMP is detected installed. When false, the "Oh My Pi" entry is hidden. */
  ompInstalled?: boolean;
};

export function WorkspaceTabs({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCreateTab,
  ompInstalled = false,
}: WorkspaceTabsProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="workspace-tabs-container">
      <div className="workspace-tabs">
        {tabs.map((tab) => {
          const Icon = kindIcons[tab.kind] ?? FileText;
          return (
            <div
              key={tab.id}
              className={`workspace-tab${tab.id === activeTabId ? " is-active" : ""}`}
            >
              <button
                className="workspace-tab-label"
                type="button"
                title={tab.title}
                onClick={() => onSelectTab(tab.id)}
              >
                <Icon size={12} />
                <span>{tab.title}</span>
              </button>
              <button
                className="btn-icon workspace-tab-close"
                title="Close tab"
                type="button"
                onClick={() => onCloseTab(tab.id)}
              >
                <X size={11} />
              </button>
            </div>
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
              <button type="button" onClick={() => { onCreateTab("chat"); setMenuOpen(false); }}>
                <MessageSquare size={12} /> Chat
              </button>
              {ompInstalled ? (
                <button type="button" onClick={() => { onCreateTab("omp"); setMenuOpen(false); }}>
                  <Zap size={12} /> Oh My Pi
                </button>
              ) : null}
              <span className="add-menu-hint">Open a file from the Files panel</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
