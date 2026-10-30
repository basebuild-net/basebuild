import { useMemo, useState } from "react";
import { Check, SlidersHorizontal, Sparkles, X } from "lucide-react";
import type { IdeaCategory } from "../../lib/ideas";
import { ModalPortal } from "../ModalPortal";
import { t } from "../../i18n";

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

const IDEA_PRESETS = () => [
  { id: "features", label: t("ideaRoundSetupModal.newFeatures"), description: t("ideaRoundSetupModal.smallCapabilitiesUsersWouldNotice") },
  { id: "fixes", label: t("ideaRoundSetupModal.fixes"), description: t("ideaRoundSetupModal.bugsRoughEdgesAndMissingSafeguards") },
  { id: "polish", label: t("ideaRoundSetupModal.polishing"), description: t("ideaRoundSetupModal.clarityConsistencyAndFeel") },
  { id: "tests", label: t("ideaRoundSetupModal.moreTests"), description: t("ideaRoundSetupModal.usefulCoverageForRiskyBehavior") },
  { id: "ux", label: t("ideaRoundSetupModal.simplerUx"), description: t("ideaRoundSetupModal.fewerStepsAndClearerChoices") },
  { id: "performance", label: t("ideaRoundSetupModal.performance"), description: t("ideaRoundSetupModal.fasterStartupAndInteractions") },
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
    return count === 0 ? t("ideaRoundSetupModal.anyUsefulIdeas") : `${count} focus area${count === 1 ? "" : "s"}`;
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
    const presetLabels = IDEA_PRESETS()
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
      <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t("ideaRoundSetupModal.configureIdeaRound")} onClick={onCancel}>
        <div className="modal modal-idea-round-setup" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header">
            <div className="idea-round-setup-heading">
              <span className="idea-round-setup-kicker">{t("ideaRoundSetupModal.ideaStudio")}</span>
              <h2>{t("ideaRoundSetupModal.whatShouldWeLookFor")}</h2>
              <p className="text-muted text-sm">{t("ideaRoundSetupModal.chooseAnyMixOrContinue")}</p>
            </div>
            <button className="btn-icon" type="button" title={t("ideaRoundSetupModal.cancelIdeaRoundSetup")} onClick={onCancel}>
              <X size={14} />
            </button>
          </div>

          <div className="modal-body idea-round-setup-body">
            <section className="idea-round-setup-section" aria-labelledby="idea-preset-title">
              <div className="row-between">
                <span id="idea-preset-title" className="idea-round-setup-label">{t("ideaRoundSetupModal.categories")}</span>
                <span className="badge" title={t("ideaRoundSetupModal.currentGenerationScope")}>{scopeLabel}</span>
              </div>
              <div className="idea-preset-grid">
                <button
                  className={`idea-preset-option${isAny ? " is-selected" : ""}`}
                  type="button"
                  aria-pressed={isAny}
                  title={t("ideaRoundSetupModal.lookForTheStrongestIdeas")}
                  onClick={() => {
                    setSelectedPresets(new Set());
                    setSelectedCategories(new Set());
                  }}
                >
                  <span className="idea-preset-check">{isAny ? <Check size={12} /> : null}</span>
                  <span><strong>{t("ideaRoundSetupModal.anythingUseful")}</strong><small>{t("ideaRoundSetupModal.letTheProjectDecide")}</small></span>
                </button>
                {IDEA_PRESETS().map((preset) => {
                  const selected = selectedPresets.has(preset.id);
                  return (
                    <button
                      className={`idea-preset-option${selected ? " is-selected" : ""}`}
                      key={preset.id}
                      type="button"
                      aria-pressed={selected}
                      title={t((selected ? "ideaRoundSetupModal.text.remove" : "ideaRoundSetupModal.text.add"), { label: preset.label })}
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
                <span id="project-category-title" className="idea-round-setup-label">{t("ideaRoundSetupModal.projectCategories")}</span>
                <div className="idea-round-category-grid">
                  {categories.map((category) => {
                    const selected = selectedCategories.has(category.id);
                    return (
                      <button
                        key={category.id}
                        className={`idea-round-category-option${selected ? " is-selected" : ""}`}
                        type="button"
                        aria-pressed={selected}
                        title={t((selected ? "ideaRoundSetupModal.text2.remove" : "ideaRoundSetupModal.text2.add"), { name: category.name })}
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

            <label className="idea-studio-direction-field" title={t("ideaRoundSetupModal.optionalExtraDirectionForThis")}>
              <span className="idea-round-setup-label">{t("ideaRoundSetupModal.anythingElse")} <span className="text-muted">{t("ideaRoundSetupModal.optional")}</span></span>
              <textarea
                className="input"
                rows={2}
                value={direction}
                maxLength={1_000}
                placeholder={t("ideaRoundSetupModal.exampleKeepEachIdeaAchievable")}
                title={t("ideaRoundSetupModal.addAnOptionalConstraintOr")}
                onChange={(event) => setDirection(event.target.value)}
              />
            </label>

            <div className="idea-studio-round-summary">
              <div>
                <span className="idea-round-setup-label">{t("ideaRoundSetupModal.round")}</span>
                <strong>{t("ideaRoundSetupModal.ideas", { ideaCount: ideaCount, scopeLabel: scopeLabel })}</strong>
              </div>
              <button
                className="btn btn-sm"
                type="button"
                title={t((showAdvanced ? "ideaRoundSetupModal.ideaCountOptions.hide" : "ideaRoundSetupModal.ideaCountOptions.show"))}
                aria-expanded={showAdvanced}
                onClick={() => setShowAdvanced((current) => !current)}
              >
                <SlidersHorizontal size={12} />
                {showAdvanced ? t("ideaRoundSetupModal.hide") : t("ideaRoundSetupModal.count")}
              </button>
            </div>

            {showAdvanced ? (
              <label className="idea-round-count-field" title={t("ideaRoundSetupModal.howManyIdeasTheModel")}>
                <span className="idea-round-setup-label">{t("ideaRoundSetupModal.numberOfIdeas")}</span>
                <input
                  className="input"
                  type="number"
                  min={5}
                  max={8}
                  value={ideaCount}
                  title={t("ideaRoundSetupModal.ideaTargetFrom5To")}
                  onChange={(event) => setIdeaCount(Math.min(8, Math.max(5, Number(event.target.value) || 8)))}
                />
              </label>
            ) : null}
          </div>

          <div className="modal-footer idea-round-setup-footer">
            <button className="btn btn-sm" type="button" title={t("ideaRoundSetupModal.cancelIdeaGeneration")} onClick={onCancel}>
              {t("ideaRoundSetupModal.cancel")}
            </button>
            <button
              className="btn btn-sm btn-primary"
              type="button"
              title={t("ideaRoundSetupModal.chooseAChatAndGenerateIdeas", { ideaCount: ideaCount, toLowerCase: scopeLabel.toLowerCase() })}
              onClick={confirmRound}
            >
              <Sparkles size={12} /> {t("ideaRoundSetupModal.chooseChat")}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
