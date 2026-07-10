import { useState, useRef, useCallback } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FileText, GitBranch, LayoutList } from "lucide-react";
import type { NewPlan, Plan, PlanStatus } from "../../lib/plans";
import type { IdeaCategory } from "../../lib/ideas";
import { PlanningInspector } from "./PlanningInspector";
import { FilesPanel } from "../panels/FilesPanel";
import { SourcePanel } from "../panels/SourcePanel";

export type SideSectionId = "plans" | "files" | "source";

type SideSectionMeta = { id: SideSectionId; icon: LucideIcon; label: string };

const DEFAULT_SECTIONS: SideSectionId[] = ["plans", "files", "source"];

const sectionMeta: Record<SideSectionId, SideSectionMeta> = {
  plans: { id: "plans", icon: LayoutList, label: "Plans" },
  files: { id: "files", icon: FileText, label: "Files" },
  source: { id: "source", icon: GitBranch, label: "Source" },
};

type SidePanelProps = {
  projectPath: string | null;
  sessionId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenFile?: (path: string) => void;
  plans: {
    plans: Plan[];
    loading: boolean;
    createPlan: (plan: NewPlan) => void;
    setPlanStatus: (id: string, status: PlanStatus) => void;
    deletePlan: (id: string) => void;
  };
  planCallbacks: {

    onEditPlan: (plan: Plan) => void;
    onFocusPlan: (plan: Plan) => void;
    onCopyReference: (refId: string) => void;
    onOpenInTerminal: (plan: Plan) => void;
  };
  onOpenChatSession: (chatSessionId: string) => void;
  onSuggestForCategory?: (category: IdeaCategory | null) => void;
  onGenerateCategories?: () => void;
  onGenerateFromFinishedPlans?: () => void;
  activeChatSessionId?: string | null;
};

function loadOrder(): SideSectionId[] {
  try {
    const raw = localStorage.getItem("bb:sideSections");
    const parsed: SideSectionId[] = raw ? JSON.parse(raw) : [];
    const valid = parsed.filter((x) => x in sectionMeta);
    if (valid.length === 3 && new Set(valid).size === 3) return valid;
  } catch {
    // ignore
  }
  return DEFAULT_SECTIONS.slice();
}

function saveOrder(order: SideSectionId[]) {
  try {
    localStorage.setItem("bb:sideSections", JSON.stringify(order));
  } catch {
    // ignore
  }
}

function SectionHeader({
  id,
  expanded,
  onToggle,
  onDragStart,
  onDragEnd,
  actions,
}: {
  id: SideSectionId;
  expanded: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  actions?: React.ReactNode;
}) {
  const meta = sectionMeta[id];
  const Icon = meta.icon;
  return (
    <div className="side-section-header">
      <span
        className="side-section-drag"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title="Drag to reorder"
      >
        <GripVertical size={12} />
      </span>
      <button
        className="side-section-toggle"
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        title={`${expanded ? "Collapse" : "Expand"} ${meta.label}`}
      >
        <Icon size={12} />
        <span className="side-section-label">{meta.label}</span>
      </button>
      {actions ? <div className="side-section-actions">{actions}</div> : null}
      <button
        className="side-section-chevron"
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        title={`${expanded ? "Collapse" : "Expand"} ${meta.label}`}
      >
        <ChevronDown size={12} className={expanded ? "rotated" : ""} />
      </button>
    </div>
  );
}

export function SidePanel({
  projectPath,
  sessionId,
  collapsed,
  onToggleCollapse,
  onOpenFile,
  plans,
  planCallbacks,
  onOpenChatSession,
  onSuggestForCategory,
  onGenerateFromFinishedPlans,
  onGenerateCategories,
  activeChatSessionId,
}: SidePanelProps) {
  const [order, setOrder] = useState<SideSectionId[]>(() => loadOrder());
  const [expanded, setExpanded] = useState<Record<SideSectionId, boolean>>({
    plans: true,
    files: true,
    source: false,
  });
  const [dragging, setDragging] = useState<SideSectionId | null>(null);
  const dragOverRef = useRef<number | null>(null);

  const toggle = useCallback((id: SideSectionId) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleDragStart = useCallback(
    (e: React.DragEvent, id: SideSectionId) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      setDragging(id);
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const insertIndex = e.clientY < midpoint ? index : index + 1;
      dragOverRef.current = insertIndex;
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain") as SideSectionId;
      const to = dragOverRef.current;
      if (!id || to === null) return;
      setOrder((prev) => {
        const from = prev.indexOf(id);
        if (from === -1) return prev;
        let insert = to;
        const next = prev.slice();
        next.splice(from, 1);
        if (from < insert) insert -= 1;
        if (insert < 0) insert = 0;
        if (insert > next.length) insert = next.length;
        next.splice(insert, 0, id);
        saveOrder(next);
        return next;
      });
      dragOverRef.current = null;
      setDragging(null);
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    dragOverRef.current = null;
    setDragging(null);
  }, []);

  const setAll = useCallback((value: boolean) => {
    setExpanded({ plans: value, files: value, source: value });
  }, []);

  if (collapsed) {
    return (
      <aside className="side-panel side-panel-collapsed" aria-label="Side panel">
        <button
          className="btn-icon"
          type="button"
          title="Expand side panel"
          aria-label="Expand side panel"
          onClick={onToggleCollapse}
        >
          <ChevronLeft size={15} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="side-panel side-panel-accordion" aria-label="Side panel">
      <div className="side-panel-header">
        <span className="side-panel-title">Inspector</span>
        <div className="side-panel-actions">
          <button
            className="btn-icon"
            type="button"
            title="Expand all sections"
            aria-label="Expand all sections"
            onClick={() => setAll(true)}
          >
            +
          </button>
          <button
            className="btn-icon"
            type="button"
            title="Collapse all sections"
            aria-label="Collapse all sections"
            onClick={() => setAll(false)}
          >
            −
          </button>
          <button
            className="btn-icon"
            type="button"
            title="Collapse side panel"
            aria-label="Collapse side panel"
            onClick={onToggleCollapse}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className="side-panel-body" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
        {order.map((id, index) => (
          <div
            key={id}
            className={`side-section${dragging === id ? " is-dragging" : ""}`}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={handleDrop}
          >
            <SectionHeader
              id={id}
              expanded={expanded[id]}
              onToggle={() => toggle(id)}
              onDragStart={(e) => handleDragStart(e, id)}
              onDragEnd={handleDragEnd}
              actions={undefined}
            />
            {expanded[id] ? (
              <div className="side-section-body">
                {id === "plans" ? (
                  <PlanningInspector
                    sessionId={sessionId}
                    projectPath={projectPath}
                    plans={plans.plans}
                    loading={plans.loading}
                    collapsed={false}
                    onToggleCollapse={() => {}}
                    {...planCallbacks}
                    onSetPlanStatus={plans.setPlanStatus}
                    onDeletePlan={plans.deletePlan}
                    onOpenChatSession={onOpenChatSession}
                    onGenerateFromFinishedPlans={onGenerateFromFinishedPlans}
                    onSuggestForCategory={onSuggestForCategory}
                    onGenerateCategories={onGenerateCategories}
                    showHeader={false}
                  />
                ) : id === "files" ? (
                  <FilesPanel projectPath={projectPath} onOpenFile={onOpenFile} />
                ) : (
                  <SourcePanel projectPath={projectPath} />
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  );
}
