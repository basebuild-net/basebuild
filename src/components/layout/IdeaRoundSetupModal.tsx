import { useMemo, useState } from "react";
import { ArrowLeft, Check, MessageSquareText, SlidersHorizontal, Sparkles, X } from "lucide-react";
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

export function IdeaRoundSetupModal({ categories, onConfirm, onCancel }: IdeaRoundSetupModalProps) {
  const [mode, setMode] = useState<"choose" | "direction">("choose");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ideaCount, setIdeaCount] = useState(8);
  const [direction, setDirection] = useState("");
  const selectionLabel = useMemo(
    () => selected.size === 0 ? "Project-wide" : `${selected.size} categor${selected.size === 1 ? "y" : "ies"}`,
    [selected],
  );
  const hasDirection = direction.trim().length > 0;

  function toggleCategory(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmRound(roundDirection: string) {
    onConfirm({
      categoryIds: [...selected],
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
              <h2>{mode === "choose" ? "How should we explore?" : "Give the studio direction"}</h2>
              <p className="text-muted text-sm">
                {mode === "choose"
                  ? "Start broad, or point the studio at a specific problem or opportunity."
                  : "Describe what you want to improve. The studio will turn it into a focused set of ideas."}
              </p>
            </div>
            <button className="btn-icon" type="button" title="Cancel idea round setup" onClick={onCancel}>
              <X size={14} />
            </button>
          </div>

          {mode === "choose" ? (
            <div className="modal-body idea-studio-choice-body">
              <div className="idea-studio-choice-grid" aria-label="Choose how to generate ideas">
                <button
                  className="idea-studio-choice"
                  type="button"
                  title="Give the idea studio a specific direction"
                  onClick={() => setMode("direction")}
                >
                  <span className="idea-studio-choice-icon" aria-hidden="true">
                    <MessageSquareText size={20} />
                  </span>
                  <span className="idea-studio-choice-copy">
                    <strong>Give direction</strong>
                    <span>Tell us what problem, feature, or opportunity the ideas should focus on.</span>
                  </span>
                  <span className="idea-studio-choice-action">Add a prompt</span>
                </button>

                <button
                  className="idea-studio-choice idea-studio-choice-primary"
                  type="button"
                  title="Automatically generate eight project-wide ideas"
                  onClick={() => onConfirm({ categoryIds: [], ideaCount: 8, direction: "" })}
                >
                  <span className="idea-studio-choice-icon" aria-hidden="true">
                    <Sparkles size={20} />
                  </span>
                  <span className="idea-studio-choice-copy">
                    <strong>Auto-generate ideas</strong>
                    <span>Let Basebuild scan the project and propose eight useful directions.</span>
                  </span>
                  <span className="idea-studio-choice-action">Project-wide</span>
                </button>
              </div>
              <p className="idea-studio-choice-note">
                Either option lets you choose the chat before anything is sent.
              </p>
            </div>
          ) : (
            <>
              <div className="modal-body idea-round-setup-body">
                <label className="idea-studio-direction-field" title="Direction for this idea round">
                  <span className="idea-round-setup-label">What should the ideas focus on?</span>
                  <textarea
                    className="input"
                    rows={4}
                    value={direction}
                    autoFocus
                    maxLength={4_000}
                    placeholder="Example: Find simple ways to make onboarding feel faster and more reassuring."
                    title="Describe the outcome, problem, or opportunity to explore"
                    onChange={(event) => setDirection(event.target.value)}
                  />
                  <span className="idea-studio-direction-helper">
                    A sentence is enough. Include constraints only when they matter.
                  </span>
                </label>

                <div className="idea-studio-round-summary">
                  <div>
                    <span className="idea-round-setup-label">Round setup</span>
                    <strong>{ideaCount} ideas · {selectionLabel}</strong>
                  </div>
                  <button
                    className="btn btn-sm"
                    type="button"
                    title={`${showAdvanced ? "Hide" : "Show"} category and idea count options`}
                    aria-expanded={showAdvanced}
                    onClick={() => setShowAdvanced((current) => !current)}
                  >
                    <SlidersHorizontal size={12} />
                    {showAdvanced ? "Hide options" : "Customize"}
                  </button>
                </div>

                {showAdvanced ? (
                  <div className="idea-studio-advanced">
                    <section className="idea-round-setup-section" aria-labelledby="idea-round-categories-title">
                      <div className="row-between">
                        <span id="idea-round-categories-title" className="idea-round-setup-label">Focus areas</span>
                        <span className="badge" title="Current round scope">{selectionLabel}</span>
                      </div>
                      {categories.length > 0 ? (
                        <div className="idea-round-category-grid">
                          {categories.map((category) => {
                            const isSelected = selected.has(category.id);
                            return (
                              <button
                                key={category.id}
                                className={`idea-round-category-option${isSelected ? " is-selected" : ""}`}
                                type="button"
                                aria-pressed={isSelected}
                                title={`${isSelected ? "Remove" : "Add"} ${category.name} ${isSelected ? "from" : "to"} this round`}
                                onClick={() => toggleCategory(category.id)}
                              >
                                <span className="idea-round-category-check" aria-hidden="true">{isSelected ? <Check size={12} /> : null}</span>
                                <span className="idea-round-category-copy">
                                  <strong>{category.name}</strong>
                                  {category.description ? <span>{category.description}</span> : null}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="card idea-round-project-wide">
                          <Sparkles size={16} />
                          <div>
                            <strong>Project-wide round</strong>
                            <p className="text-muted text-sm">The model will scan the schematic and propose ideas across the project.</p>
                          </div>
                        </div>
                      )}
                    </section>

                    <label className="idea-round-count-field" title="How many grounded ideas the model should propose">
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
                  </div>
                ) : null}
              </div>

              <div className="modal-footer idea-round-setup-footer">
                <button
                  className="btn btn-sm"
                  type="button"
                  title="Return to generation choices"
                  onClick={() => setMode("choose")}
                >
                  <ArrowLeft size={12} /> Back
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  type="button"
                  title={hasDirection ? `Continue with ${ideaCount} ideas across ${selectionLabel.toLowerCase()}` : "Add a direction to continue"}
                  disabled={!hasDirection}
                  onClick={() => confirmRound(direction.trim())}
                >
                  <Sparkles size={12} /> Choose chat
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
