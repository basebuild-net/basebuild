import { useState, useRef, useCallback } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FileText, GitBranch, LayoutList } from "lucide-react";
import type { NewPlan, Plan, PlanStatus } from "../../lib/plans";
import { PlanPanel } from "./PlanPanel";
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
    onCreatePlan: () => void;
    onGeneratePlans: () => void;
    onEditPlan: (plan: Plan) => void;
    onFocusPlan: (plan: Plan) => void;
    onCopyReference: (refId: string) => void;
    onOpenInTerminal: (plan: Plan) => void;
    onEnhancePlan?: (plan: Plan) => void;
  };
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
  dragHandleProps,
}: {
  id: SideSectionId;
  expanded: boolean;
  onToggle: () => void;
  dragHandleProps: {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
}) {
  const meta = sectionMeta[id];
  const Icon = meta.icon;
  return (
    <button
      className="side-section-header"
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
    >
      <span className="side-section-drag" {...dragHandleProps}>
        <GripVertical size={12} />
      </span>
      <Icon size={12} />
      <span className="side-section-label">{meta.label}</span>
      <ChevronDown size={12} className={expanded ? "rotated" : ""} />
    </button>
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
      setDragging(id);
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      dragOverRef.current = index;
    },
    [],
  );

  const handleDrop = useCallback(() => {
    if (!dragging || dragOverRef.current === null) return;
    const from = order.indexOf(dragging);
    const to = dragOverRef.current;
    if (from === -1 || from === to) return;
    const next = order.slice();
    next.splice(from, 1);
    next.splice(to, 0, dragging);
    setOrder(next);
    saveOrder(next);
    dragOverRef.current = null;
    setDragging(null);
  }, [dragging, order]);

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
          <button className="btn-icon" type="button" title="Expand all" aria-label="Expand all" onClick={() => setAll(true)}>
            +
          </button>
          <button className="btn-icon" type="button" title="Collapse all" aria-label="Collapse all" onClick={() => setAll(false)}>
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
      <div className="side-panel-body">
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
              dragHandleProps={{
                draggable: true,
                onDragStart: (e) => handleDragStart(e, id),
                onDragEnd: () => setDragging(null),
              }}
            />
            {expanded[id] ? (
              <div className="side-section-body">
                {id === "plans" ? (
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
