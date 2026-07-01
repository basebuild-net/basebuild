import { useState } from "react";
import { ChevronLeft, ChevronRight, FileText, GitBranch, LayoutList } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NewPlan, Plan, PlanStatus } from "../../lib/plans";
import { PlanPanel } from "./PlanPanel";
import { FilesPanel } from "../panels/FilesPanel";
import { SourcePanel } from "../panels/SourcePanel";

export type SideTabId = "plans" | "files" | "source";

type SideTabItem = { id: SideTabId; icon: LucideIcon; label: string };

const sideTabs: SideTabItem[] = [
  { id: "plans", icon: LayoutList, label: "Plans" },
  { id: "files", icon: FileText, label: "Files" },
  { id: "source", icon: GitBranch, label: "Source" },
];

type SidePanelProps = {
  projectPath: string | null;
  sessionId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  plans: {
    plans: Plan[];
    loading: boolean;
    createPlan: (plan: NewPlan) => void;
    setPlanStatus: (id: string, status: PlanStatus) => void;
    deletePlan: (id: string) => void;
  };
  planCallbacks: {
    onCreatePlan: () => void;
    onGeneratePlans: () => void;
    onEditPlan: (plan: Plan) => void;
    onFocusPlan: (plan: Plan) => void;
    onCopyReference: (refId: string) => void;
    onOpenInTerminal: (plan: Plan) => void;
    onEnhancePlan?: (plan: Plan) => void;
  };
};

export function SidePanel({
  projectPath,
  sessionId,
  collapsed,
  onToggleCollapse,
  plans,
  planCallbacks,
}: SidePanelProps) {
  const [activeTab, setActiveTab] = useState<SideTabId>("plans");

  if (collapsed) {
    return (
      <aside className="side-panel side-panel-collapsed" aria-label="Side panel">
        <button className="btn-icon" type="button" title="Expand side panel" aria-label="Expand side panel" onClick={onToggleCollapse}>
          <ChevronLeft size={15} />
        </button>
        <div className="side-tabs-collapsed">
          {sideTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`side-tab-collapsed${tab.id === activeTab ? " is-active" : ""}`}
                type="button"
                title={tab.label}
                aria-label={tab.label}
                onClick={() => {
                  setActiveTab(tab.id);
                  onToggleCollapse();
                }}
              >
                <Icon size={16} />
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside className="side-panel" aria-label="Side panel">
      <div className="side-panel-header">
        <div className="side-tabs">
          {sideTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                className={`side-tab${isActive ? " is-active" : ""}`}
                type="button"
                title={tab.label}
                aria-label={tab.label}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={12} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        <button className="btn-icon" type="button" title="Collapse side panel" aria-label="Collapse side panel" onClick={onToggleCollapse}>
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="side-panel-body">
        {activeTab === "plans" ? (
          <PlanPanel
            sessionId={sessionId}
            plans={plans.plans}
            loading={plans.loading}
            collapsed={false}
            onToggleCollapse={() => {}}
            {...planCallbacks}
            onSetPlanStatus={plans.setPlanStatus}
            onDeletePlan={plans.deletePlan}
            showHeader={false}
          />
        ) : activeTab === "files" ? (
          <FilesPanel projectPath={projectPath} />
        ) : (
          <SourcePanel projectPath={projectPath} />
        )}
      </div>
    </aside>
  );
}
