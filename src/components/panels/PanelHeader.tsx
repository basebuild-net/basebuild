import type { PointerEvent as ReactPointerEvent } from "react";
import {
  GripVertical,
  MessageSquare,
  SplitSquareHorizontal,
  SplitSquareVertical,
  TerminalSquare,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SurfaceKind, SurfaceRecord } from "../../lib/workspaceState";
import { humanizeChatTitle } from "../../lib/titles";
import { t } from "../../i18n";

const surfaceIcons: Record<SurfaceKind, LucideIcon> = {
  chat: MessageSquare,
  "omp-chat": Zap,
  terminal: TerminalSquare,
};

export type PanelHeaderProps = {
  surface: SurfaceRecord;
  isActive: boolean;
  onFocus: () => void;
  onClose: () => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** When true, the surface hosts a background agent — show a minimize
   *  button instead of close. */
  minimizable?: boolean;
  /** When true, split buttons are disabled (capacity exceeded). */
  splitDisabled?: boolean;
  /** Tooltip explaining why split is disabled. */
  splitDisabledReason?: string;
  /** Override the surface title with a disambiguated display title. */
  displayTitle?: string;
};

export function PanelHeader(props: PanelHeaderProps) {
  const {
    surface,
    isActive,
    onFocus,
    onClose,
    onSplitRight,
    onSplitDown,
    onPointerDown,
    minimizable,
    splitDisabled,
    splitDisabledReason,
    displayTitle: displayTitleOverride,
  } = props;

  const Icon = surfaceIcons[surface.kind] ?? MessageSquare;
  const displayTitle = displayTitleOverride ?? humanizeChatTitle(surface.title ?? t("panelHeader.untitled"));
  const splitHorizontalTitle = splitDisabled
    ? splitDisabledReason ?? t("panelHeader.splitDisabledNotEnoughSpace")
    : t("panelHeader.splitHorizontallyTopAndBottom");
  const splitVerticalTitle = splitDisabled
    ? splitDisabledReason ?? t("panelHeader.splitDisabledNotEnoughSpace")
    : t("panelHeader.splitVerticallyLeftAndRight");

  return (
    <div
      className={`panel-header${isActive ? " is-active" : ""}`}
      onClick={onFocus}
      onPointerDown={onPointerDown}
      data-surface-id={surface.id}
      data-surface-kind={surface.kind}
    >
      <span className="panel-header-drag-handle" title={t("panelHeader.dragThisTitleBarTo")}>
        <GripVertical size={11} />
      </span>
      <span className="panel-header-surface-icon" title={displayTitle}>
        <Icon size={12} />
      </span>
      <span className="panel-header-surface-title" title={t("panelHeader.dragToMoveLinkOrUnlink", { displayTitle: displayTitle })}>
        {displayTitle}
      </span>
      <div className="panel-header-actions">
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title={splitHorizontalTitle}
          disabled={splitDisabled}
          onClick={(event) => { event.stopPropagation(); onSplitDown(); }}
        >
          <SplitSquareHorizontal size={11} />
        </button>
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title={splitVerticalTitle}
          disabled={splitDisabled}
          onClick={(event) => { event.stopPropagation(); onSplitRight(); }}
        >
          <SplitSquareVertical size={11} />
        </button>
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title={minimizable ? t("panelHeader.minimizeToBackgroundAgents") : t("panelHeader.closeAndMoveToHistory")}
          onClick={(event) => { event.stopPropagation(); onClose(); }}
        >
          <X size={11} />
        </button>
      </div>
    </div>
  );
}
