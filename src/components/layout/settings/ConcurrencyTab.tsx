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
        <h3>Run Concurrency</h3>
        <LoadingBlock label="Loading run concurrency…" />
      </div>
    );
  }

  const allProviders = providers.length > 0
    ? providers
    : [{ id: "basebuild-local", label: "None" }, { id: "basebuild-native", label: "Basebuild Native" }];

  return (
    <div className="stack">
      <h3>Run Concurrency</h3>
      <div className="settings-concurrency-limits">
        <h4 className="settings-concurrency-limits-heading">Category Limits</h4>
        <p className="text-muted text-sm" title="Global caps across all providers; planning cap reserves slots for non-planning work">
          Global caps across all providers. Planning cap reserves slots for non-planning work (background agents, etc.).
        </p>
        <div className="settings-concurrency-limits-row">
          <label className="settings-concurrency-limit-field" title="Max concurrent runs across all providers (plan + pipeline). Default 4.">
            <span className="settings-concurrency-limit-label">Global max</span>
            <input
              type="number"
              min={1}
              max={16}
              value={concurrencyLimits.globalMax}
              disabled={savingLimits}
              title="Max concurrent runs across all providers (plan + pipeline). Default 4."
              onChange={(e) => {
                const v = Math.max(1, Math.min(16, Number(e.target.value) || 4));
                setConcurrencyLimitsState((prev) => ({ ...prev, globalMax: v }));
              }}
              onBlur={() => void saveConcurrencyLimits(concurrencyLimits)}
            />
          </label>
          <label className="settings-concurrency-limit-field" title="Max concurrent planning runs. Default 3 (reserves 1 slot for non-planning).">
            <span className="settings-concurrency-limit-label">Planning max</span>
            <input
              type="number"
              min={1}
              max={16}
              value={concurrencyLimits.planningMax}
              disabled={savingLimits}
              title="Max concurrent planning runs. Default 3 (reserves 1 slot for non-planning)."
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
      <h4 className="settings-concurrency-limits-heading">Per-Provider Limits</h4>
      <p className="text-muted text-sm">
        Per-provider max concurrency for plan runs + subagents. Default is 1 (most providers meter concurrency).
        Project overrides take precedence over global defaults. Subagents are off by default.
      </p>
      <div className="settings-table">
        <div className="settings-table-header">
          <span>Provider</span>
          <span>Global max</span>
          <span>Project max</span>
          <span>Subagents</span>
          <span>Subagent cap</span>
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
                title={`Global max concurrency for ${p.label} (default 1)`}
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
                title={`Project override for ${p.label} (empty = use global; set 0 to disable)`}
                value={project?.maxConcurrency ?? ""}
                placeholder={String(global.maxConcurrency)}
                disabled={saving === p.id}
                onChange={(e) => {
                  const v = e.target.value === "" ? 0 : Math.max(0, Math.min(16, Number(e.target.value) || 0));
                  void saveProvider(p.id, { ...effective, maxConcurrency: v || global.maxConcurrency }, true);
                }}
              />
              <label className="settings-checkbox" title={`Enable subagents for ${p.label}`}>
                <input
                  type="checkbox"
                  checked={effective.subagentsEnabled}
                  onChange={(e) => {
                    const next = { ...effective, subagentsEnabled: e.target.checked };
                    void saveProvider(p.id, next, !!project || e.target.checked);
                  }}
                />
                <span className="text-sm">{effective.subagentsEnabled ? "on" : "off"}</span>
              </label>
              <input
                className="input"
                type="number"
                min={0}
                max={8}
                title={`Max concurrent subagents for ${p.label} (counted against the provider limit)`}
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
      <p className="text-muted text-sm" title="Effective value = project override else global default">
        Effective value shown at the point of use when a run is queued.
      </p>
    </div>
  );
}
