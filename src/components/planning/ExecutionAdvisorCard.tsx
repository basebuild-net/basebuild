import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BrainCircuit, Check, Code2, Loader2, RefreshCw, Route } from "lucide-react";
import {
  clearExecutionAdviceOverride,
  getExecutionAdvice,
  recordExecutionAdviceFeedback,
  setExecutionAdviceOverride,
  type ExecutionAdviceBundle,
  type ExecutionRole,
  type RoleExecutionAdvice,
  type RouteRecommendation,
} from "../../lib/execution-advisor";
import { nativeCatalogSync } from "../../lib/native-chat";

type ExecutionAdvisorCardProps = {
  projectPath: string;
  planId?: string;
  ideaId?: string;
  autoLoad?: boolean;
  compact?: boolean;
};

function RoleRecommendation({
  advice,
  busy,
  onOverride,
  onClearOverride,
}: {
  advice: RoleExecutionAdvice;
  busy: boolean;
  onOverride: (role: ExecutionRole, route: RouteRecommendation) => Promise<void>;
  onClearOverride: (role: ExecutionRole) => Promise<void>;
}) {
  const Icon = advice.role === "planner" ? BrainCircuit : Code2;
  const recommendation = advice.recommendation;
  return (
    <section className="execution-advisor-role" aria-label={`${advice.role} recommendation`}>
      <div className="execution-advisor-role-header">
        <span><Icon size={13} /> {advice.role === "planner" ? "Planner" : "Coder"}</span>
        <span className={`execution-advisor-confidence is-${advice.confidence}`} title={`Recommendation confidence: ${advice.confidence}`}>
          {advice.confidence} confidence
        </span>
      </div>
      {recommendation ? (
        <>
          <div className="execution-advisor-route">
            <div>
              <strong>{recommendation.label}</strong>
              <code>{recommendation.providerId}/{recommendation.modelId}</code>
            </div>
            <span title={`Local advisor score ${recommendation.score.toFixed(1)}`}>{recommendation.score.toFixed(1)}</span>
          </div>
          {recommendation.userOverride ? (
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              title={`Clear the ${advice.role} model override`}
              disabled={busy}
              onClick={() => void onClearOverride(advice.role)}
            >
              <Check size={11} /> User choice · reset
            </button>
          ) : (
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              title={`Use the recommended ${advice.role} route for this project`}
              disabled={busy}
              onClick={() => void onOverride(advice.role, recommendation)}
            >
              <Check size={11} /> Use recommendation
            </button>
          )}
          <details className="execution-advisor-details">
            <summary title={`Explain the ${advice.role} recommendation`}>Why this route</summary>
            <ul>
              {recommendation.factors.map((factor) => (
                <li key={factor.name}>
                  <strong>{factor.name.replaceAll("_", " ")}</strong>
                  <span>{factor.score.toFixed(1)}/{factor.maxScore.toFixed(0)} · {factor.explanation}</span>
                </li>
              ))}
            </ul>
            <p>{recommendation.sourceFreshness.join(" · ")}</p>
          </details>
          {advice.alternatives.length > 0 ? (
            <div className="execution-advisor-alternatives" aria-label={`${advice.role} alternatives`}>
              <span>Alternatives</span>
              {advice.alternatives.map((alternative) => (
                <button
                  key={`${alternative.providerId}/${alternative.modelId}`}
                  className="btn btn-sm"
                  type="button"
                  title={`Use ${alternative.label} as the ${advice.role} route for this project`}
                  disabled={busy}
                  onClick={() => void onOverride(advice.role, alternative)}
                >
                  {alternative.label} · {alternative.score.toFixed(1)}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="execution-advisor-empty" title="No connected route passed the plan's hard requirements">
          <AlertTriangle size={13} />
          <span>No compatible route. {advice.excluded[0]?.reasons[0] ?? "Connect a provider or refresh the catalog."}</span>
        </div>
      )}
    </section>
  );
}

export function ExecutionAdvisorCard({
  projectPath,
  planId,
  ideaId,
  autoLoad = false,
  compact = false,
}: ExecutionAdvisorCardProps) {
  const [advice, setAdvice] = useState<ExecutionAdviceBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refreshCatalog = false) => {
    setLoading(true);
    setError(null);
    try {
      if (refreshCatalog) await nativeCatalogSync();
      setAdvice(await getExecutionAdvice({ projectPath, planId, ideaId }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [ideaId, planId, projectPath]);

  useEffect(() => {
    if (autoLoad) void load();
  }, [autoLoad, load]);

  const override = async (role: ExecutionRole, route: RouteRecommendation) => {
    setLoading(true);
    try {
      await setExecutionAdviceOverride({
        projectPath,
        role,
        providerId: route.providerId,
        modelId: route.modelId,
      });
      const previousRecommendation = advice?.[role].recommendation;
      if (previousRecommendation) {
        await recordExecutionAdviceFeedback({
          role,
          recommendedProviderId: previousRecommendation.providerId,
          recommendedModelId: previousRecommendation.modelId,
          selectedProviderId: route.providerId,
          selectedModelId: route.modelId,
          outcome:
            previousRecommendation.providerId === route.providerId
            && previousRecommendation.modelId === route.modelId
              ? "accepted"
              : "overridden",
          confidence: previousRecommendation.confidence,
          difficultyBucket: advice.difficultyBucket,
          effortBucket: advice.effortBucket,
        }).catch(() => undefined);
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
    }
  };

  const clearOverride = async (role: ExecutionRole) => {
    setLoading(true);
    try {
      await clearExecutionAdviceOverride({ projectPath, role });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
    }
  };

  if (!advice && !loading && !error) {
    return (
      <button
        className={`execution-advisor-load${compact ? " is-compact" : ""}`}
        type="button"
        title="Compare this estimate with connected provider routes and local usage"
        onClick={() => void load()}
      >
        <Route size={13} /> Recommend models
      </button>
    );
  }

  return (
    <div className={`execution-advisor-card${compact ? " is-compact" : ""}`}>
      <div className="execution-advisor-header">
        <span><Route size={14} /> Execution advisor</span>
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title="Refresh public model evidence and recompute local recommendations"
          disabled={loading}
          onClick={() => void load(true)}
        >
          <RefreshCw size={12} className={loading ? "is-spinning" : undefined} />
        </button>
      </div>
      {loading && !advice ? (
        <div className="execution-advisor-loading" role="status"><Loader2 size={14} className="is-spinning" /> Comparing compatible routes…</div>
      ) : null}
      {error ? <p className="execution-advisor-error" role="alert">{error}</p> : null}
      {advice ? (
        <>
          {advice.assessmentStale ? (
            <p className="execution-advisor-stale"><AlertTriangle size={12} /> The plan estimate changed; refresh its assessment before launching.</p>
          ) : null}
          <div className="execution-advisor-roles">
            <RoleRecommendation advice={advice.planner} busy={loading} onOverride={override} onClearOverride={clearOverride} />
            <RoleRecommendation advice={advice.coder} busy={loading} onOverride={override} onClearOverride={clearOverride} />
          </div>
          <p className="execution-advisor-boundary" title="Recommendations are computed locally; only public model evidence is downloaded">
            Local decision · public evidence only · no project text uploaded
          </p>
        </>
      ) : null}
    </div>
  );
}
