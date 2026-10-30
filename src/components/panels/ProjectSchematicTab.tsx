import { useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { useProjectSchematic } from "../../state/schematic";
import type { SchematicReport, SectionReport } from "../../lib/schematic";
import { t } from "../../i18n";

export type ProjectSchematicTabProps = {
  projectPath: string | null;
  /** Start the guided schematic wizard in chat (optional section to focus). */
  onStartWizard: (section?: string) => void;
  /** Open the raw markdown editor modal. */
  onOpenRaw: () => void;
};

const sectionGuide = (): Record<string, string> => ({
  Purpose: t("projectSchematicTab.whatTheProjectDoesForWhom"),
  Vision: t("projectSchematicTab.whatTheProjectShouldBecomeSteers"),
  Blueprint: t("projectSchematicTab.archetypeTeamSizeAndStageScopes"),
  "End goals": t("projectSchematicTab.timeBoxedGoalsYearEndMonth"),
  "Target users": t("projectSchematicTab.primaryUsersAndTheirTopJobs"),
  "Tech stack": t("projectSchematicTab.runtimeFrameworkLanguagesKeyDependencies"),
  "Architecture notes": t("projectSchematicTab.majorLayersDataModelInvariantsKey"),
  "Design constraints": t("projectSchematicTab.hardVisualSystemRulesCoreProject"),
  "Development conventions": t("projectSchematicTab.namingErrorsTestingDocsCoreProject"),
  "Current priorities": t("projectSchematicTab.top35OpenConcernsRanked"),
  "Open questions": t("projectSchematicTab.whatIsUnclearDecisionsNeedingA"),
});

const healthLabel = (): Record<string, string> => ({
  complete: t("projectSchematicTab.complete"),
  partial: t("projectSchematicTab.partial"),
  missing: t("projectSchematicTab.missing"),
});

export function ProjectSchematicTab({ projectPath, onStartWizard, onOpenRaw }: ProjectSchematicTabProps) {
  const schematic = useProjectSchematic(projectPath);
  const [raw, setRaw] = useState(false);

  if (!projectPath) {
    return (
      <div className="empty-state">
        <h3>{t("projectSchematicTab.noProject")}</h3>
        <p>{t("projectSchematicTab.openAProjectToView")}</p>
      </div>
    );
  }

  if (schematic.loading) {
    return (
      <div className="empty-state">
        <p>{t("projectSchematicTab.loadingSchematic")}</p>
      </div>
    );
  }

  if (!schematic.exists) {
    return (
      <div className="empty-state">
        <h3>{t("projectSchematicTab.projectDescriptionMissing")}</h3>
        <p>{t("projectSchematicTab.thisProjectHasNo")} <code>{t("projectSchematicTab.basebuildProjectSchematicMd")}</code> {t("projectSchematicTab.yet")}</p>
        <div className="empty-state-actions">
          <button className="btn btn-primary" type="button" title={t("projectSchematicTab.startProjectDescriptionWizard")} onClick={() => onStartWizard()}>
            <Sparkles size={12} /> {t("projectSchematicTab.startWizard")}
          </button>
          <button className="btn" type="button" title={t("projectSchematicTab.editProjectDescriptionRawFile")} onClick={onOpenRaw}>{t("projectSchematicTab.editRaw")}</button>
        </div>
      </div>
    );
  }

  const report = schematic.report;
  const showNudge = report && (report.missingYearGoal || report.missingMonthGoal || report.staleGoal);

  return (
    <div className="project-schematic-tab">
      <div className="project-schematic-toolbar">
        <span className="project-schematic-toolbar-title">{t("projectSchematicTab.basebuildProjectSchematicMd")}</span>
        {report && (
          <button
            className={`schematic-health-badge is-${report.health}`}
            type="button"
            title={t("projectSchematicTab.schematicClickForRawView", { health: report.health, value: report.health === "complete" ? t("projectSchematicTab.allCoreSectionsFilled") : report.sections.filter((s) => s.state !== "filled").map((s) => s.name).join(", ") || t("projectSchematicTab.allFilled") })}
            onClick={onOpenRaw}
          >
            {healthLabel()[report.health]}
          </button>
        )}
        <button
          className="btn btn-sm btn-primary"
          type="button"
          title={t("projectSchematicTab.startTheGuidedSchematicWizard")}
          onClick={() => onStartWizard()}
        >
          <Wand2 size={11} /> {t("projectSchematicTab.startWizard")}
        </button>
        <button
          className="btn btn-sm"
          type="button"
          title={raw ? t("projectSchematicTab.showStructuredSectionCards") : t("projectSchematicTab.showRawMarkdownSource")}
          onClick={() => setRaw((v) => !v)}
        >
          {raw ? t("projectSchematicTab.cards") : t("projectSchematicTab.raw")}
        </button>
        <button className="btn btn-sm" type="button" title={t("projectSchematicTab.editTheRawSchematicMarkdown")} onClick={onOpenRaw}>
          {t("projectSchematicTab.edit")}
        </button>
      </div>

      {showNudge && (
        <div className="schematic-nudge">
          <span className="text-sm">
            {report!.missingYearGoal && report!.missingMonthGoal
              ? t("projectSchematicTab.setAYearEndAnd")
              : report!.missingYearGoal
                ? t("projectSchematicTab.setAYearEndGoal")
                : report!.missingMonthGoal
                  ? t("projectSchematicTab.setAMonthEndGoal")
                  : t("projectSchematicTab.anEndGoalSPeriod")}
          </span>
          <button
            className="btn btn-sm"
            type="button"
            title={t("projectSchematicTab.openTheSchematicWizardTo")}
            onClick={() => onStartWizard(t("projectSchematicTab.endGoals"))}
          >
            {t("projectSchematicTab.fix")}
          </button>
        </div>
      )}

      <div className="project-schematic-content">
        {raw || !report ? (
          <pre className="schematic-raw">{schematic.content}</pre>
        ) : (
          report.sections.map((section) => (
            <SectionCard key={section.name} section={section} report={report} onFill={(name) => onStartWizard(name)} />
          ))
        )}
      </div>
    </div>
  );
}

function SectionCard({
  section,
  report,
  onFill,
}: {
  section: SectionReport;
  report: SchematicReport;
  onFill: (section: string) => void;
}) {
  const isEndGoals = section.name === "End goals";
  const isFilled = section.state === "filled";

  return (
    <div className={`schematic-section-card is-${section.state}`}>
      <div className="schematic-section-header">
        <span className="schematic-section-title">{section.name}</span>
        <span className={`schematic-section-state is-${section.state}`} title={t("projectSchematicTab.section", { state: section.state })}>
          {section.state}
        </span>
        {!isFilled && (
          <div className="schematic-section-actions">
            <button
              className="btn btn-sm"
              type="button"
              title={t("projectSchematicTab.runTheWizardForTheSection", { name: section.name })}
              onClick={() => onFill(section.name)}
            >
              {t("projectSchematicTab.fill")}
            </button>
          </div>
        )}
      </div>
      {isFilled ? (
        isEndGoals && report.endGoals.length > 0 ? (
          <div className="schematic-section-body">
            {report.endGoals.map((goal, i) => (
              <div key={i} className="schematic-end-goal-row">
                <span className="schematic-end-goal-period">{goal.period}</span>
                <span>{goal.statement}</span>
                {goal.stale && <span className="schematic-end-goal-stale" title={t("projectSchematicTab.thisGoalSPeriodHas")}>{t("projectSchematicTab.stale")}</span>}
              </div>
            ))}
          </div>
        ) : null
      ) : (
        <p className="schematic-section-placeholder">{sectionGuide()[section.name] ?? t("projectSchematicTab.fillInThisSection")}</p>
      )}
    </div>
  );
}
