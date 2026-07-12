import { useRef, type KeyboardEvent } from "react";

export type OptionListOption<T extends string> = {
  id: T;
  label: string;
  /** Tooltip — required per design system (tooltips on every interactive element). */
  title: string;
  disabled?: boolean;
};

export type OptionListProps<T extends string> = {
  value: T;
  options: OptionListOption<T>[];
  onChange: (id: T) => void;
  /** aria-label for the button group. */
  label: string;
  /** Compact mode: smaller padding for dense forms. */
  compact?: boolean;
  disabled?: boolean;
};

/// Square option list — replaces native <select> for enumerated 2-6 option
/// sets per DESIGN.md "Selection controls". All options are always visible;
/// the active one carries aria-pressed and the CTA underline. Arrow keys move
/// focus between options; Enter/Space select.
export function OptionList<T extends string>({ value, options, onChange, label, compact, disabled }: OptionListProps<T>) {
  const groupRef = useRef<HTMLDivElement | null>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const group = groupRef.current;
    if (!group) return;
    const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1 || buttons.length === 0) return;
    e.preventDefault();
    const next = e.key === "ArrowRight"
      ? (current + 1) % buttons.length
      : (current - 1 + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label={label}
      className={`option-list${compact ? " option-list-compact" : ""}`}
      onKeyDown={handleKeyDown}
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`option-list-btn${opt.id === value ? " is-active" : ""}`}
          title={opt.title}
          aria-pressed={opt.id === value}
          disabled={disabled || opt.disabled}
          onClick={() => { if (opt.id !== value) onChange(opt.id); }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
