import { AlertTriangle, Clock3, Gauge, ShieldCheck, Sparkles } from "lucide-react";
import type { ImplementationAssessment } from "../../lib/planning-assessment";

type IdeaAssessmentSummaryProps = {
  assessment?: ImplementationAssessment;
  grounding?: string | null;
  anchor?: string | null;
  compact?: boolean;
};

const metricMeta = [
  { key: "difficulty", label: "Difficulty", icon: Gauge },
  { key: "impact", label: "Impact", icon: Sparkles },
  { key: "risk", label: "Risk", icon: AlertTriangle },
  { key: "confidence", label: "Confidence", icon: ShieldCheck },
] as const;

export function IdeaAssessmentSummary({
  assessment,
  grounding,
  anchor,
  compact = false,
}: IdeaAssessmentSummaryProps) {
  if (!assessment) {
    return (
      <div className="idea-assessment-empty" title="This legacy idea has no structured implementation estimate">
        <Clock3 size={13} />
        <span>Estimate unavailable</span>
        {anchor ? <code>{anchor}</code> : null}
      </div>
    );
  }

  const evidence = [grounding, ...assessment.grounding].filter((value): value is string => Boolean(value?.trim()));
  return (
    <div className={`idea-assessment${compact ? " is-compact" : ""}`}>
      <div className="idea-assessment-metrics" aria-label="Implementation estimate">
        <div className="idea-assessment-effort" title={`Estimated implementation effort: ${assessment.effort.minHours} to ${assessment.effort.maxHours} hours`}>
          <Clock3 size={14} />
          <span>
            <small>Estimated effort</small>
            <strong>{assessment.effort.minHours}–{assessment.effort.maxHours}h</strong>
          </span>
        </div>
        {metricMeta.map(({ key, label, icon: Icon }) => (
          <div className="idea-assessment-metric" key={key} title={`${label}: ${assessment[key]} of 5`}>
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
          <p className="idea-assessment-rationale"><strong>Why this estimate:</strong> {assessment.rationale}</p>
          <details className="idea-assessment-evidence">
            <summary title="Show evidence, constraints, and alternatives">Evidence and caveats</summary>
            <div className="idea-assessment-evidence-grid">
              <div>
                <strong>Grounding</strong>
                {anchor ? <code>{anchor}</code> : null}
                {evidence.length > 0 ? <ul>{evidence.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <span>Not supplied</span>}
              </div>
              <div>
                <strong>Capabilities</strong>
                {assessment.requiredCapabilities.length > 0 ? <ul>{assessment.requiredCapabilities.map((item) => <li key={item}>{item}</li>)}</ul> : <span>None identified</span>}
              </div>
              <div>
                <strong>Constraints</strong>
                {assessment.constraints.length > 0 ? <ul>{assessment.constraints.map((item) => <li key={item}>{item}</li>)}</ul> : <span>None identified</span>}
              </div>
              <div>
                <strong>Missing evidence</strong>
                {assessment.missingEvidence.length > 0 ? <ul>{assessment.missingEvidence.map((item) => <li key={item}>{item}</li>)}</ul> : <span>None identified</span>}
              </div>
              {assessment.alternatives.length > 0 ? (
                <div>
                  <strong>Alternatives considered</strong>
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
