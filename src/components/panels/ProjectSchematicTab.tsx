import { useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { useProjectSchematic } from "../../state/schematic";
import type { SchematicReport, SectionReport } from "../../lib/schematic";

export type ProjectSchematicTabProps = {
  projectPath: string | null;
  /** Start the guided schematic wizard in chat (optional section to focus). */
  onStartWizard: (section?: string) => void;
  /** Open the raw markdown editor modal. */
  onOpenRaw: () => void;
};

const SECTION_GUIDE: Record<string, string> = {
  Purpose: "What the project does, for whom, and why it exists.",
  Vision: "What the project should become — steers idea generation.",
  Blueprint: "Archetype, team size, and stage — scopes planning.",
  "End goals": "Time-boxed goals (year-end, month-end) keep work on track.",
  "Target users": "Primary users and their top jobs.",
  "Tech stack": "Runtime, framework, languages, key dependencies.",
  "Architecture notes": "Major layers, data model, invariants, key folders.",
  "Design constraints": "Hard visual/system rules — core project rules.",
  "Development conventions": "Naming, errors, testing, docs — core project rules.",
  "Current priorities": "Top 3–5 open concerns, ranked.",
  "Open questions": "What is unclear; decisions needing a human.",
};

const HEALTH_LABEL: Record<string, string> = {
  complete: "Complete",
  partial: "Partial",
  missing: "Missing",
};

export function ProjectSchematicTab({ projectPath, onStartWizard, onOpenRaw }: ProjectSchematicTabProps) {
  const schematic = useProjectSchematic(projectPath);
  const [raw, setRaw] = useState(false);

  if (!projectPath) {
    return (
      <div className="empty-state">
        <h3>No project</h3>
        <p>Open a project to view its schematic and plan context.</p>
      </div>
    );
  }

  if (schematic.loading) {
    return (
      <div className="empty-state">
        <p>Loading schematic...</p>
      </div>
    );
  }

  if (!schematic.exists) {
    return (
      <div className="empty-state">
        <h3>Project description missing</h3>
        <p>This project has no <code>.basebuild/project-schematic.md</code> yet.</p>
        <div className="empty-state-actions">
          <button className="btn btn-primary" type="button" onClick={() => onStartWizard()}>
            <Sparkles size={12} /> Start wizard
          </button>
          <button className="btn" type="button" onClick={onOpenRaw}>Edit raw</button>
        </div>
      </div>
    );
  }

  const report = schematic.report;
  const showNudge = report && (report.missingYearGoal || report.missingMonthGoal || report.staleGoal);

  return (
    <div className="project-schematic-tab">
      <div className="project-schematic-toolbar">
        <span className="project-schematic-toolbar-title">.basebuild/project-schematic.md</span>
        {report && (
          <button
            className={`schematic-health-badge is-${report.health}`}
            type="button"
            title={`Schematic ${report.health}: ${report.health === "complete" ? "all core sections filled" : report.sections.filter((s) => s.state !== "filled").map((s) => s.name).join(", ") || "all filled"} — click for raw view`}
            onClick={onOpenRaw}
          >
            {HEALTH_LABEL[report.health]}
          </button>
        )}
        <button
          className="btn btn-sm btn-primary"
          type="button"
          title="Start the guided schematic wizard — asks questions one at a time, prefills from the repo, and writes only after approval"
          onClick={() => onStartWizard()}
        >
          <Wand2 size={11} /> Start wizard
        </button>
        <button
          className="btn btn-sm"
          type="button"
          title={raw ? "Show structured section cards" : "Show raw markdown source"}
          onClick={() => setRaw((v) => !v)}
        >
          {raw ? "Cards" : "Raw"}
        </button>
        <button className="btn btn-sm" type="button" title="Edit the raw schematic markdown" onClick={onOpenRaw}>
          Edit
        </button>
      </div>

      {showNudge && (
        <div className="schematic-nudge">
          <span className="text-sm">
            {report!.missingYearGoal && report!.missingMonthGoal
              ? "Set a year-end and a month-end goal to keep things on track."
              : report!.missingYearGoal
                ? "Set a year-end goal to keep things on track."
                : report!.missingMonthGoal
                  ? "Set a month-end goal to keep things on track."
                  : "An end goal's period has passed — refresh it."}
          </span>
          <button
            className="btn btn-sm"
            type="button"
            title="Open the schematic wizard to fix this"
            onClick={() => onStartWizard("End goals")}
          >
            Fix
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
        <span className={`schematic-section-state is-${section.state}`} title={`Section ${section.state}`}>
          {section.state}
        </span>
        {!isFilled && (
          <div className="schematic-section-actions">
            <button
              className="btn btn-sm"
              type="button"
              title={`Run the wizard for the ${section.name} section — asks one question at a time, prefills from the repo`}
              onClick={() => onFill(section.name)}
            >
              Fill
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
                {goal.stale && <span className="schematic-end-goal-stale" title="This goal's period has passed">stale</span>}
              </div>
            ))}
          </div>
        ) : null
      ) : (
        <p className="schematic-section-placeholder">{SECTION_GUIDE[section.name] ?? "Fill in this section."}</p>
      )}
    </div>
  );
}
