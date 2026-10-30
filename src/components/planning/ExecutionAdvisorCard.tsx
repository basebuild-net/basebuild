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
import { t } from "../../i18n";

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
    <section className="execution-advisor-role" aria-label={t("executionAdvisorCard.recommendation", { role: advice.role })}>
      <div className="execution-advisor-role-header">
        <span><Icon size={13} /> {advice.role === "planner" ? t("executionAdvisorCard.planner") : t("executionAdvisorCard.coder")}</span>
        <span className={`execution-advisor-confidence is-${advice.confidence}`} title={t("executionAdvisorCard.recommendationConfidence", { confidence: advice.confidence })}>
          {t("executionAdvisorCard.confidence", { confidence: advice.confidence })}
        </span>
      </div>
      {recommendation ? (
        <>
          <div className="execution-advisor-route">
            <div>
              <strong>{recommendation.label}</strong>
              <code>{recommendation.providerId}/{recommendation.modelId}</code>
            </div>
            <span title={t("executionAdvisorCard.localAdvisorScore", { value: recommendation.score.toFixed(1) })}>{recommendation.score.toFixed(1)}</span>
          </div>
          {recommendation.userOverride ? (
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              title={t("executionAdvisorCard.clearTheModelOverride", { role: advice.role })}
              disabled={busy}
              onClick={() => void onClearOverride(advice.role)}
            >
              <Check size={11} /> {t("executionAdvisorCard.userChoiceReset")}
            </button>
          ) : (
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              title={t("executionAdvisorCard.useTheRecommendedRouteForThis", { role: advice.role })}
              disabled={busy}
              onClick={() => void onOverride(advice.role, recommendation)}
            >
              <Check size={11} /> {t("executionAdvisorCard.useRecommendation")}
            </button>
          )}
          <details className="execution-advisor-details">
            <summary title={t("executionAdvisorCard.explainTheRecommendation", { role: advice.role })}>{t("executionAdvisorCard.whyThisRoute")}</summary>
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
            <div className="execution-advisor-alternatives" aria-label={t("executionAdvisorCard.alternatives2", { role: advice.role })}>
              <span>{t("executionAdvisorCard.alternatives")}</span>
              {advice.alternatives.map((alternative) => (
                <button
                  key={`${alternative.providerId}/${alternative.modelId}`}
                  className="btn btn-sm"
                  type="button"
                  title={t("executionAdvisorCard.useAsTheRouteForThis", { label: alternative.label, role: advice.role })}
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
        <div className="execution-advisor-empty" title={t("executionAdvisorCard.noConnectedRoutePassedThe")}>
          <AlertTriangle size={13} />
          <span>{t("executionAdvisorCard.noCompatibleRoute", { reason: advice.excluded[0]?.reasons[0] ?? t("executionAdvisorCard.connectAProviderOrRefresh") })}</span>
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
        title={t("executionAdvisorCard.compareThisEstimateWithConnected")}
        onClick={() => void load()}
      >
        <Route size={13} /> {t("executionAdvisorCard.recommendModels")}
      </button>
    );
  }

  return (
    <div className={`execution-advisor-card${compact ? " is-compact" : ""}`}>
      <div className="execution-advisor-header">
        <span><Route size={14} /> {t("executionAdvisorCard.executionAdvisor")}</span>
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title={t("executionAdvisorCard.refreshPublicModelEvidenceAnd")}
          disabled={loading}
          onClick={() => void load(true)}
        >
          <RefreshCw size={12} className={loading ? "is-spinning" : undefined} />
        </button>
      </div>
      {loading && !advice ? (
        <div className="execution-advisor-loading" role="status"><Loader2 size={14} className="is-spinning" /> {t("executionAdvisorCard.comparingCompatibleRoutes")}</div>
      ) : null}
      {error ? <p className="execution-advisor-error" role="alert">{error}</p> : null}
      {advice ? (
        <>
          {advice.assessmentStale ? (
            <p className="execution-advisor-stale"><AlertTriangle size={12} /> {t("executionAdvisorCard.thePlanEstimateChangedRefresh")}</p>
          ) : null}
          <div className="execution-advisor-roles">
            <RoleRecommendation advice={advice.planner} busy={loading} onOverride={override} onClearOverride={clearOverride} />
            <RoleRecommendation advice={advice.coder} busy={loading} onOverride={override} onClearOverride={clearOverride} />
          </div>
          <p className="execution-advisor-boundary" title={t("executionAdvisorCard.recommendationsAreComputedLocallyOnly")}>
            {t("executionAdvisorCard.localDecisionPublicEvidenceOnly")}
          </p>
        </>
      ) : null}
    </div>
  );
}
