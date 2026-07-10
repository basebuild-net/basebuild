import { useEffect, useMemo, useRef } from "react";
import {
  BUILTIN_COMMANDS,
  filterAndRank,
  buildCommandHelper,
  tabComplete,
  sourceLabel,
  categoryLabel,
  type ChatCommand,
  type RankedCommand,
} from "../../lib/chatCommands";

/**
 * Command palette popup for the chat composer.
 *
 * Renders a large, filterable list of slash commands with names, descriptions,
 * source badges, usage text, and active-option state. The parent component
 * owns keyboard handling (ArrowUp/ArrowDown/Tab/Enter/Escape) and passes
 * `activeIndex` + `onActiveIndexChange` as controlled props.
 *
 * Uses globals.css only — 0px radius, Basebuild Mono colors, tooltips on
 * every interactive element.
 */

export type CommandPaletteProps = {
  /** The current composer draft (e.g. `/mo`). */
  input: string;
  /** Whether the palette is open. */
  open: boolean;
  /** Recency map for ranking. */
  recency: Record<string, number>;
  /** Active option index (controlled by parent). */
  activeIndex: number;
  /** Called when the active index should change. */
  onActiveIndexChange: (index: number) => void;
  /** Called when the user clicks a command (fills the composer, does not execute). */
  onPick: (text: string) => void;
};

export function CommandPalette({
  input,
  open,
  recency,
  activeIndex,
  onActiveIndexChange,
  onPick,
}: CommandPaletteProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Extract the query (text after `/`).
  const query = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return "";
    return trimmed.slice(1);
  }, [input]);

  const ranked: RankedCommand[] = useMemo(() => {
    if (!open) return [];
    return filterAndRank(BUILTIN_COMMANDS, query, recency);
  }, [open, query, recency]);

  const helper = useMemo(() => buildCommandHelper(input), [input]);

  // Scroll active option into view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-cmd-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  if (!open) return null;

  return (
    <div className="command-palette" ref={listRef} role="listbox" aria-label="Slash commands">
      {ranked.length === 0 ? (
        <div className="command-palette-empty" title="No commands match your filter">
          No commands match "{query}". Press Escape to close.
        </div>
      ) : (
        ranked.map((cmd, i) => (
          <button
            key={cmd.name}
            type="button"
            className={`command-palette-row${i === activeIndex ? " is-active" : ""}`}
            data-cmd-index={i}
            role="option"
            aria-selected={i === activeIndex}
            title={`${cmd.usage} — ${cmd.description}`}
            onClick={() => onPick(tabComplete(cmd))}
            onMouseEnter={() => onActiveIndexChange(i)}
          >
            <span className="command-palette-name">/{cmd.name}</span>
            <span className="command-palette-desc">{cmd.description}</span>
            <span className="command-palette-source" data-source={cmd.source}>
              {sourceLabel(cmd.source)}
            </span>
            <span
              className={`command-palette-badge is-${cmd.category}`}
              title={cmd.category === "in-chat"
                ? "In-Chat — does something in the conversation (injects a skill, generates output, etc.)"
                : "UI — triggers a Basebuild UI action (opens a picker, clears chat, stops a request)"}
            >
              {categoryLabel(cmd.category)}
            </span>
          </button>
        ))
      )}
      {helper.recognized && helper.command ? (
        <div className="command-palette-helper" title={`Usage: ${helper.usage}`}>
          <span className="command-palette-helper-usage">{helper.usage}</span>
          {helper.requiredArgs.length > 0 ? (
            <span className="command-palette-helper-args">
              Required: {helper.requiredArgs.join(", ")}
            </span>
          ) : null}
          {helper.optionalArgs.length > 0 ? (
            <span className="command-palette-helper-args is-optional">
              Optional: {helper.optionalArgs.join(", ")}
            </span>
          ) : null}
          {helper.validationError ? (
            <span className="command-palette-helper-error">{helper.validationError}</span>
          ) : null}
          {helper.examples.length > 0 ? (
            <span className="command-palette-helper-examples">
              Example: {helper.examples[0]}
            </span>
          ) : null}
        </div>
      ) : helper.validationError ? (
        <div className="command-palette-helper" title={helper.validationError}>
          <span className="command-palette-helper-error">{helper.validationError}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Re-export for parent keyboard handling. */
export { filterAndRank, tabComplete, BUILTIN_COMMANDS };
export type { ChatCommand, RankedCommand };
