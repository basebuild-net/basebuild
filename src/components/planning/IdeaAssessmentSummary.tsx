import { AlertTriangle, Clock3, Gauge, ShieldCheck, Sparkles } from "lucide-react";
import type { ImplementationAssessment } from "../../lib/planning-assessment";
import { t } from "../../i18n";

type IdeaAssessmentSummaryProps = {
  assessment?: ImplementationAssessment;
  grounding?: string | null;
  anchor?: string | null;
  compact?: boolean;
};

const metricMeta = () => [
  { key: "difficulty", label: t("ideaAssessmentSummary.difficulty"), icon: Gauge },
  { key: "impact", label: t("ideaAssessmentSummary.impact"), icon: Sparkles },
  { key: "risk", label: t("ideaAssessmentSummary.risk"), icon: AlertTriangle },
  { key: "confidence", label: t("ideaAssessmentSummary.confidence"), icon: ShieldCheck },
] as const;

export function IdeaAssessmentSummary({
  assessment,
  grounding,
  anchor,
  compact = false,
}: IdeaAssessmentSummaryProps) {
  if (!assessment) {
    return (
      <div className="idea-assessment-empty" title={t("ideaAssessmentSummary.thisLegacyIdeaHasNo")}>
        <Clock3 size={13} />
        <span>{t("ideaAssessmentSummary.estimateUnavailable")}</span>
        {anchor ? <code>{anchor}</code> : null}
      </div>
    );
  }

  const evidence = [grounding, ...assessment.grounding].filter((value): value is string => Boolean(value?.trim()));
  return (
    <div className={`idea-assessment${compact ? " is-compact" : ""}`}>
      <div className="idea-assessment-metrics" aria-label={t("ideaAssessmentSummary.implementationEstimate")}>
        <div className="idea-assessment-effort" title={t("ideaAssessmentSummary.estimatedImplementationEffortToHours", { minHours: assessment.effort.minHours, maxHours: assessment.effort.maxHours })}>
          <Clock3 size={14} />
          <span>
            <small>{t("ideaAssessmentSummary.estimatedEffort")}</small>
            <strong>{t("ideaAssessmentSummary.h", { minHours: assessment.effort.minHours, maxHours: assessment.effort.maxHours })}</strong>
          </span>
        </div>
        {metricMeta().map(({ key, label, icon: Icon }) => (
          <div className="idea-assessment-metric" key={key} title={t("ideaAssessmentSummary.of5", { label: label, value: assessment[key] })}>
            <Icon size={13} />
            <span>
              <small>{label}</small>
              <strong>{assessment[key]}/5</strong>
            </span>
          </div>
        ))}
      </div>

      {!compact ? (
        <>
          <p className="idea-assessment-rationale"><strong>{t("ideaAssessmentSummary.whyThisEstimate")}</strong> {assessment.rationale}</p>
          <details className="idea-assessment-evidence">
            <summary title={t("ideaAssessmentSummary.showEvidenceConstraintsAndAlternatives")}>{t("ideaAssessmentSummary.evidenceAndCaveats")}</summary>
            <div className="idea-assessment-evidence-grid">
              <div>
                <strong>{t("ideaAssessmentSummary.grounding")}</strong>
                {anchor ? <code>{anchor}</code> : null}
                {evidence.length > 0 ? <ul>{evidence.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <span>{t("ideaAssessmentSummary.notSupplied")}</span>}
              </div>
              <div>
                <strong>{t("ideaAssessmentSummary.capabilities")}</strong>
                {assessment.requiredCapabilities.length > 0 ? <ul>{assessment.requiredCapabilities.map((item) => <li key={item}>{item}</li>)}</ul> : <span>{t("ideaAssessmentSummary.noneIdentified")}</span>}
              </div>
              <div>
                <strong>{t("ideaAssessmentSummary.constraints")}</strong>
                {assessment.constraints.length > 0 ? <ul>{assessment.constraints.map((item) => <li key={item}>{item}</li>)}</ul> : <span>{t("ideaAssessmentSummary.noneIdentified")}</span>}
              </div>
              <div>
                <strong>{t("ideaAssessmentSummary.missingEvidence")}</strong>
                {assessment.missingEvidence.length > 0 ? <ul>{assessment.missingEvidence.map((item) => <li key={item}>{item}</li>)}</ul> : <span>{t("ideaAssessmentSummary.noneIdentified")}</span>}
              </div>
              {assessment.alternatives.length > 0 ? (
                <div>
                  <strong>{t("ideaAssessmentSummary.alternativesConsidered")}</strong>
                  <ul>{assessment.alternatives.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              ) : null}
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
