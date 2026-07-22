import { useState } from "react";
import {
  Copy,
  MessageSquare,
  Minus,
  MoreVertical,
  SplitSquareHorizontal,
  SplitSquareVertical,
  TerminalSquare,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SurfaceKind, SurfaceRecord } from "../../lib/workspaceState";
import { humanizeChatTitle } from "../../lib/titles";

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
  onDuplicate: () => void;
  /** When true, the surface hosts a background agent — show a minimize
   *  button instead of close. */
  minimizable?: boolean;
  /** When true, split buttons are disabled (capacity exceeded). */
  splitDisabled?: boolean;
  /** Tooltip explaining why split is disabled. */
  splitDisabledReason?: string;
};

export function PanelHeader(props: PanelHeaderProps) {
  const { surface, isActive, onFocus, onClose, onSplitRight, onSplitDown, onDuplicate, minimizable, splitDisabled, splitDisabledReason } = props;
  const [menuOpen, setMenuOpen] = useState(false);

  const Icon = surfaceIcons[surface.kind] ?? MessageSquare;
  const displayTitle = humanizeChatTitle(surface.title ?? "Untitled");

  const splitRightTitle = splitDisabled
    ? splitDisabledReason ?? "Split disabled — not enough space"
    : "Split right (add surface beside)";
  const splitDownTitle = splitDisabled
    ? splitDisabledReason ?? "Split disabled — not enough space"
    : "Split down (add surface below)";

  return (
    <div
      className={`panel-header${isActive ? " is-active" : ""}`}
      onClick={onFocus}
      data-surface-id={surface.id}
      data-surface-kind={surface.kind}
    >
      <span className="panel-header-surface-icon" title={displayTitle}>
        <Icon size={12} />
      </span>
      <span
        className="panel-header-surface-title"
        title={displayTitle}
      >
        {displayTitle}
      </span>
      <div className="panel-header-actions">
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title={splitRightTitle}
          disabled={splitDisabled}
          onClick={(e) => { e.stopPropagation(); onSplitRight(); }}
        >
          <SplitSquareHorizontal size={11} />
        </button>
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title={splitDownTitle}
          disabled={splitDisabled}
          onClick={(e) => { e.stopPropagation(); onSplitDown(); }}
        >
          <SplitSquareVertical size={11} />
        </button>
        <div className="panel-header-more-wrap">
          <button
            className="btn-icon btn-icon-sm"
            type="button"
            title="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          >
            <MoreVertical size={11} />
          </button>
          {menuOpen ? (
            <div className="panel-header-menu" role="menu" onMouseLeave={() => setMenuOpen(false)}>
              <button
                type="button"
                role="menuitem"
                title="Duplicate this surface"
                onClick={() => { setMenuOpen(false); onDuplicate(); }}
              >
                <Copy size={11} /> Duplicate
              </button>
              <button
                type="button"
                role="menuitem"
                title={splitRightTitle}
                disabled={splitDisabled}
                onClick={() => { setMenuOpen(false); onSplitRight(); }}
              >
                <SplitSquareHorizontal size={11} /> Split right
              </button>
              <button
                type="button"
                role="menuitem"
                title={splitDownTitle}
                disabled={splitDisabled}
                onClick={() => { setMenuOpen(false); onSplitDown(); }}
              >
                <SplitSquareVertical size={11} /> Split down
              </button>
              <button
                type="button"
                role="menuitem"
                title={minimizable ? "Send to background agents" : "Close and move to history"}
                onClick={() => { setMenuOpen(false); onClose(); }}
              >
                {minimizable ? <Minus size={11} /> : <X size={11} />} {minimizable ? "Minimize" : "Close"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
