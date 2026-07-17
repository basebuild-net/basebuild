import { useMemo, useState } from "react";
import { Check, SlidersHorizontal, Sparkles, X } from "lucide-react";
import type { IdeaCategory } from "../../lib/ideas";
import { ModalPortal } from "../ModalPortal";

export type IdeaRoundSetup = {
  categoryIds: string[];
  ideaCount: number;
  direction: string;
};

type IdeaRoundSetupModalProps = {
  categories: IdeaCategory[];
  onConfirm: (setup: IdeaRoundSetup) => void;
  onCancel: () => void;
};

const IDEA_PRESETS = [
  { id: "features", label: "New features", description: "Small capabilities users would notice." },
  { id: "fixes", label: "Fixes", description: "Bugs, rough edges, and missing safeguards." },
  { id: "polish", label: "Polishing", description: "Clarity, consistency, and feel." },
  { id: "tests", label: "More tests", description: "Useful coverage for risky behavior." },
  { id: "ux", label: "Simpler UX", description: "Fewer steps and clearer choices." },
  { id: "performance", label: "Performance", description: "Faster startup and interactions." },
] as const;

export function IdeaRoundSetupModal({ categories, onConfirm, onCancel }: IdeaRoundSetupModalProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set());
  const [ideaCount, setIdeaCount] = useState(8);
  const [direction, setDirection] = useState("");
  const isAny = selectedPresets.size === 0 && selectedCategories.size === 0;
  const scopeLabel = useMemo(() => {
    const count = selectedPresets.size + selectedCategories.size;
    return count === 0 ? "Any useful ideas" : `${count} focus area${count === 1 ? "" : "s"}`;
  }, [selectedPresets, selectedCategories]);

  function toggleSelection(setter: typeof setSelectedPresets, id: string) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmRound() {
    const presetLabels = IDEA_PRESETS
      .filter((preset) => selectedPresets.has(preset.id))
      .map((preset) => preset.label);
    const roundDirection = [
      presetLabels.length > 0 ? `Focus on: ${presetLabels.join(", ")}.` : "",
      direction.trim(),
    ].filter(Boolean).join(" ");
    onConfirm({
      categoryIds: [...selectedCategories],
      ideaCount,
      direction: roundDirection,
    });
  }

  return (
    <ModalPortal>
      <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Configure idea round" onClick={onCancel}>
        <div className="modal modal-idea-round-setup" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header">
            <div className="idea-round-setup-heading">
              <span className="idea-round-setup-kicker">Idea studio</span>
              <h2>What should we look for?</h2>
              <p className="text-muted text-sm">Choose any mix, or continue with everything. The model will keep titles short and put the detail underneath.</p>
            </div>
            <button className="btn-icon" type="button" title="Cancel idea round setup" onClick={onCancel}>
              <X size={14} />
            </button>
          </div>

          <div className="modal-body idea-round-setup-body">
            <section className="idea-round-setup-section" aria-labelledby="idea-preset-title">
              <div className="row-between">
                <span id="idea-preset-title" className="idea-round-setup-label">Categories</span>
                <span className="badge" title="Current generation scope">{scopeLabel}</span>
              </div>
              <div className="idea-preset-grid">
                <button
                  className={`idea-preset-option${isAny ? " is-selected" : ""}`}
                  type="button"
                  aria-pressed={isAny}
                  title="Look for the strongest ideas across every category"
                  onClick={() => {
                    setSelectedPresets(new Set());
                    setSelectedCategories(new Set());
                  }}
                >
                  <span className="idea-preset-check">{isAny ? <Check size={12} /> : null}</span>
                  <span><strong>Anything useful</strong><small>Let the project decide.</small></span>
                </button>
                {IDEA_PRESETS.map((preset) => {
                  const selected = selectedPresets.has(preset.id);
                  return (
                    <button
                      className={`idea-preset-option${selected ? " is-selected" : ""}`}
                      key={preset.id}
                      type="button"
                      aria-pressed={selected}
                      title={`${selected ? "Remove" : "Add"} ${preset.label}`}
                      onClick={() => toggleSelection(setSelectedPresets, preset.id)}
                    >
                      <span className="idea-preset-check">{selected ? <Check size={12} /> : null}</span>
                      <span><strong>{preset.label}</strong><small>{preset.description}</small></span>
                    </button>
                  );
                })}
              </div>
            </section>

            {categories.length > 0 ? (
              <section className="idea-round-setup-section" aria-labelledby="project-category-title">
                <span id="project-category-title" className="idea-round-setup-label">Project categories</span>
                <div className="idea-round-category-grid">
                  {categories.map((category) => {
                    const selected = selectedCategories.has(category.id);
                    return (
                      <button
                        key={category.id}
                        className={`idea-round-category-option${selected ? " is-selected" : ""}`}
                        type="button"
                        aria-pressed={selected}
                        title={`${selected ? "Remove" : "Add"} ${category.name}`}
                        onClick={() => toggleSelection(setSelectedCategories, category.id)}
                      >
                        <span className="idea-round-category-check" aria-hidden="true">{selected ? <Check size={12} /> : null}</span>
                        <span className="idea-round-category-copy">
                          <strong>{category.name}</strong>
                          {category.description ? <span>{category.description}</span> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <label className="idea-studio-direction-field" title="Optional extra direction for this idea round">
              <span className="idea-round-setup-label">Anything else? <span className="text-muted">Optional</span></span>
              <textarea
                className="input"
                rows={2}
                value={direction}
                maxLength={1_000}
                placeholder="Example: Keep each idea achievable in one afternoon."
                title="Add an optional constraint or outcome"
                onChange={(event) => setDirection(event.target.value)}
              />
            </label>

            <div className="idea-studio-round-summary">
              <div>
                <span className="idea-round-setup-label">Round</span>
                <strong>{ideaCount} ideas · {scopeLabel}</strong>
              </div>
              <button
                className="btn btn-sm"
                type="button"
                title={`${showAdvanced ? "Hide" : "Show"} idea count options`}
                aria-expanded={showAdvanced}
                onClick={() => setShowAdvanced((current) => !current)}
              >
                <SlidersHorizontal size={12} />
                {showAdvanced ? "Hide" : "Count"}
              </button>
            </div>

            {showAdvanced ? (
              <label className="idea-round-count-field" title="How many ideas the model should propose">
                <span className="idea-round-setup-label">Number of ideas</span>
                <input
                  className="input"
                  type="number"
                  min={5}
                  max={8}
                  value={ideaCount}
                  title="Idea target, from 5 to 8"
                  onChange={(event) => setIdeaCount(Math.min(8, Math.max(5, Number(event.target.value) || 8)))}
                />
              </label>
            ) : null}
          </div>

          <div className="modal-footer idea-round-setup-footer">
            <button className="btn btn-sm" type="button" title="Cancel idea generation" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="btn btn-sm btn-primary"
              type="button"
              title={`Choose a chat and generate ${ideaCount} ideas across ${scopeLabel.toLowerCase()}`}
              onClick={confirmRound}
            >
              <Sparkles size={12} /> Choose chat
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
