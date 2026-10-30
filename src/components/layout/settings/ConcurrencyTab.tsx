import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { nativeProviderCatalog } from "../../../lib/native-chat";
import {
  getRunConcurrencyDefaults,
  setRunConcurrencyDefaults,
  getRunConcurrencyOverrides,
  setRunConcurrencyOverride,
  getConcurrencyLimits,
  setConcurrencyLimits,
  DEFAULT_CONCURRENCY_LIMITS,
  DEFAULT_RUN_CONCURRENCY_ENTRY,
  type RunConcurrencyEntry,
  type ConcurrencyLimits,
} from "../../../lib/runConcurrency";
import { LoadingBlock } from "../Loading";
import { t } from "../../../i18n";

export function ConcurrencyTab({ projectPath }: { projectPath: string | null }) {
  const projectPathNonNull = projectPath ?? "";
  const [concurrencyLimits, setConcurrencyLimitsState] = useState<ConcurrencyLimits>(DEFAULT_CONCURRENCY_LIMITS);
  const [savingLimits, setSavingLimits] = useState(false);
  const [globalLimits, setGlobalLimits] = useState<Record<string, RunConcurrencyEntry>>({});
  const [projectLimits, setProjectLimits] = useState<Record<string, RunConcurrencyEntry>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [providers, setProviders] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [global, project, catalog, limits] = await Promise.all([
          getRunConcurrencyDefaults(),
          getRunConcurrencyOverrides(projectPathNonNull),
          nativeProviderCatalog(),
          getConcurrencyLimits(),
        ]);
        if (cancelled) return;
        setGlobalLimits(global.providers);
        setProjectLimits(project.providers);
        setProviders(catalog.providers.map((p) => ({ id: p.id, label: p.label })));
        setConcurrencyLimitsState(limits);
      } catch {
        // ignore — empty state shows
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [projectPathNonNull]);

  async function saveProvider(providerId: string, entry: RunConcurrencyEntry, isProject: boolean) {
    setSaving(providerId);
    try {
      if (isProject) {
        await setRunConcurrencyOverride(projectPathNonNull, providerId, entry);
        setProjectLimits((prev) => ({ ...prev, [providerId]: entry }));
      } else {
        const next = { ...globalLimits, [providerId]: entry };
        await setRunConcurrencyDefaults({ providers: next });
        setGlobalLimits(next);
      }
    } catch {
      // ignore
    } finally {
      setSaving(null);
    }
  }

  async function saveConcurrencyLimits(limits: ConcurrencyLimits) {
    setSavingLimits(true);
    try {
      await setConcurrencyLimits(limits);
      setConcurrencyLimitsState(limits);
    } catch {
      // ignore
    } finally {
      setSavingLimits(false);
    }
  }

  if (loading) {
    return (
      <div className="stack">
        <h3>{t("concurrencyTab.runConcurrency")}</h3>
        <LoadingBlock label={t("concurrencyTab.loadingRunConcurrency")} />
      </div>
    );
  }

  const allProviders = providers.length > 0
    ? providers
    : [{ id: "basebuild-local", label: t("concurrencyTab.none") }, { id: "basebuild-native", label: t("concurrencyTab.basebuildNative") }];

  return (
    <div className="stack">
      <h3>{t("concurrencyTab.runConcurrency")}</h3>
      <div className="settings-concurrency-limits">
        <h4 className="settings-concurrency-limits-heading">{t("concurrencyTab.categoryLimits")}</h4>
        <p className="text-muted text-sm" title={t("concurrencyTab.globalCapsAcrossAllProviders2")}>
          {t("concurrencyTab.globalCapsAcrossAllProviders")}
        </p>
        <div className="settings-concurrency-limits-row">
          <label className="settings-concurrency-limit-field" title={t("concurrencyTab.maxConcurrentRunsAcrossAll")}>
            <span className="settings-concurrency-limit-label">{t("concurrencyTab.globalMax")}</span>
            <input
              type="number"
              min={1}
              max={16}
              value={concurrencyLimits.globalMax}
              disabled={savingLimits}
              title={t("concurrencyTab.maxConcurrentRunsAcrossAll")}
              onChange={(e) => {
                const v = Math.max(1, Math.min(16, Number(e.target.value) || 4));
                setConcurrencyLimitsState((prev) => ({ ...prev, globalMax: v }));
              }}
              onBlur={() => void saveConcurrencyLimits(concurrencyLimits)}
            />
          </label>
          <label className="settings-concurrency-limit-field" title={t("concurrencyTab.maxConcurrentPlanningRunsDefault")}>
            <span className="settings-concurrency-limit-label">{t("concurrencyTab.planningMax")}</span>
            <input
              type="number"
              min={1}
              max={16}
              value={concurrencyLimits.planningMax}
              disabled={savingLimits}
              title={t("concurrencyTab.maxConcurrentPlanningRunsDefault")}
              onChange={(e) => {
                const v = Math.max(1, Math.min(16, Number(e.target.value) || 3));
                setConcurrencyLimitsState((prev) => ({ ...prev, planningMax: v }));
              }}
              onBlur={() => void saveConcurrencyLimits(concurrencyLimits)}
            />
          </label>
          {savingLimits ? <Loader2 size={12} className="is-spinning" /> : null}
        </div>
      </div>
      <h4 className="settings-concurrency-limits-heading">{t("concurrencyTab.perProviderLimits")}</h4>
      <p className="text-muted text-sm">
        {t("concurrencyTab.perProviderMaxConcurrencyFor")}
      </p>
      <div className="settings-table">
        <div className="settings-table-header">
          <span>{t("concurrencyTab.provider")}</span>
          <span>{t("concurrencyTab.globalMax")}</span>
          <span>{t("concurrencyTab.projectMax")}</span>
          <span>{t("concurrencyTab.subagents")}</span>
          <span>{t("concurrencyTab.subagentCap")}</span>
        </div>
        {allProviders.map((p) => {
          const global = globalLimits[p.id] ?? DEFAULT_RUN_CONCURRENCY_ENTRY;
          const project = projectLimits[p.id] ?? null;
          const effective = project ?? global;
          return (
            <div key={p.id} className="settings-table-row">
              <span title={p.id}>{p.label}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={16}
                title={t("concurrencyTab.globalMaxConcurrencyForDefault1", { label: p.label })}
                value={global.maxConcurrency}
                disabled={saving === p.id}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(16, Number(e.target.value) || 1));
                  void saveProvider(p.id, { ...global, maxConcurrency: v }, false);
                }}
              />
              <input
                className="input"
                type="number"
                min={0}
                max={16}
                title={t("concurrencyTab.projectOverrideForEmptyUseGlobal", { label: p.label })}
                value={project?.maxConcurrency ?? ""}
                placeholder={String(global.maxConcurrency)}
                disabled={saving === p.id}
                onChange={(e) => {
                  const v = e.target.value === "" ? 0 : Math.max(0, Math.min(16, Number(e.target.value) || 0));
                  void saveProvider(p.id, { ...effective, maxConcurrency: v || global.maxConcurrency }, true);
                }}
              />
              <label className="settings-checkbox" title={t("concurrencyTab.enableSubagentsFor", { label: p.label })}>
                <input
                  type="checkbox"
                  checked={effective.subagentsEnabled}
                  onChange={(e) => {
                    const next = { ...effective, subagentsEnabled: e.target.checked };
                    void saveProvider(p.id, next, !!project || e.target.checked);
                  }}
                />
                <span className="text-sm">{effective.subagentsEnabled ? t("concurrencyTab.on") : t("concurrencyTab.off")}</span>
              </label>
              <input
                className="input"
                type="number"
                min={0}
                max={8}
                title={t("concurrencyTab.maxConcurrentSubagentsForCountedAgainst", { label: p.label })}
                value={effective.subagentMaxCount}
                disabled={!effective.subagentsEnabled || saving === p.id}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(8, Number(e.target.value) || 0));
                  void saveProvider(p.id, { ...effective, subagentMaxCount: v }, !!project);
                }}
              />
            </div>
          );
        })}
      </div>
      <p className="text-muted text-sm" title={t("concurrencyTab.effectiveValueProjectOverrideElse")}>
        {t("concurrencyTab.effectiveValueShownAtThe")}
      </p>
    </div>
  );
}
