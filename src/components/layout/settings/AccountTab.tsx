import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, LogOut, RefreshCw, RotateCcw, ShieldCheck, User } from "lucide-react";
import { authStartDeviceFlow, authPollDeviceFlow } from "../../../lib/auth";
import type { AccountState } from "../../../state/account";
import { useUsageSync } from "../../../state/usageSync";
import {
  usageDetectProviderPlans,
  usageListProviderPlans,
  usageDeclareProviderPlans,
} from "../../../lib/usageSync";
import type {
  AutoSyncStatus,
  DetectedProviderPlan,
  ProviderPlanOption,
  SourceSyncStatus,
  SyncOverallOutcome,
  UsageSyncSource,
} from "../../../lib/usageSync";

export function AccountPanel({ account }: { account: AccountState }) {
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  async function signIn() {
    setError(null);
    setPolling(true);
    try {
      const result = await authStartDeviceFlow({
        clientName: "Basebuild Desktop",
        platform: navigator.platform,
      });
      setDeviceCode(result.deviceCode);

      // Poll until success, denial, or expiry
      const tick = async () => {
        try {
          const pollResult = await authPollDeviceFlow(result.deviceCode);
          if (pollResult.status === "pending") {
            setTimeout(() => void tick(), (pollResult.interval + 1) * 1000);
          } else if (pollResult.status === "success") {
            await account.refresh();
            setPolling(false);
            setDeviceCode(null);
          } else if (pollResult.status === "denied") {
            setError("Sign-in was denied.");
            setPolling(false);
            setDeviceCode(null);
          } else {
            setError("The sign-in code expired. Please try again.");
            setPolling(false);
            setDeviceCode(null);
          }
        } catch (e) {
          setError(String(e));
          setPolling(false);
          setDeviceCode(null);
        }
      };
      setTimeout(() => void tick(), (result.interval + 1) * 1000);
    } catch (e) {
      setError(String(e));
      setPolling(false);
    }
  }


  if (account.loading) {
    return <p className="text-muted">Loading account…</p>;
  }

  if (account.profile) {
    return (
      <div className="stack">
        <h3>Account</h3>
        <div className="row gap-sm account-profile-row">
          {account.profile.image && !imgFailed ? (
            <img
              src={account.profile.image}
              alt={account.profile.username}
              className="account-avatar"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <span className="account-avatar account-avatar-placeholder">
              {account.profile.username.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div>
            <div className="text-sm">{account.profile.username}</div>
            <div className="text-muted text-sm">{account.profile.email}</div>
          </div>
        </div>
        <button
          className="btn btn-sm"
          type="button"
          title="Sign out and revoke this device's token"
          onClick={() => void account.signOut()}
        >
          <LogOut size={12} /> Sign out
        </button>
        {error ? <p className="text-danger text-sm">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="stack">
      <h3>Account</h3>
      <p className="text-muted text-sm">
        Sign in with your basebuild.net account to sync usage through MCP
        without creating an API key. The app works as a guest without signing in.
      </p>
      {polling ? (
        <p className="text-muted text-sm">Waiting for browser approval… Check your browser to approve the sign-in.</p>
      ) : (
        <button
          className="btn btn-primary"
          type="button"
          title="Open browser to sign in to basebuild.net"
          onClick={() => void signIn()}
        >
          <User size={12} /> Sign in
        </button>
      )}
      {error ? <p className="text-danger text-sm">{error}</p> : null}
    </div>
  );
}

const SOURCE_LABELS: Record<UsageSyncSource, string> = {
  native: "Basebuild",
  omp: "OMP",
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

const OUTCOME_LABELS: Record<SyncOverallOutcome, string> = {
  success: "Synced",
  partial: "Partial",
  failed: "Failed",
  nothing_to_sync: "Up to date",
};

export function usageSyncOffReasonText(status: AutoSyncStatus): string | null {
  if (status.gatesPass) return null;
  switch (status.offReason) {
    case "usage_sharing_disabled":
      return "Usage sharing is off. Turn on Share anonymous aggregate usage below to sync.";
    case "auto_sync_disabled":
      return "Auto-sync is off. Turn it on to schedule usage sync.";
    case "consent_required":
      return "Usage sharing isn't on yet. Turn on Share anonymous aggregate usage below to sync.";
    case "no_sources_available":
      return "No supported local usage sources are currently available.";
    case "retry_backoff":
      return "A previous attempt failed. A retry is waiting for its backoff window.";
    default:
      return "Usage sync is off. Review Share anonymous aggregate usage below.";
  }
}

function sourceState(source: SourceSyncStatus): { label: string; className: string } {
  if (!source.available) return { label: "Unavailable", className: "is-muted" };
  if (source.pendingRetry) return { label: "Retry pending", className: "is-warning" };
  if (source.lastError) return { label: "Needs attention", className: "is-error" };
  if (source.lastSuccessAt) return { label: "Synced", className: "is-ok" };
  return { label: "Ready", className: "is-muted" };
}

function formatSyncTime(timestamp?: number): string {
  return timestamp ? new Date(timestamp * 1000).toLocaleString() : "Never";
}

export function UsageSyncPanel() {
  const {
    status,
    projected,
    loading,
    error,
    lastSyncResult,
    fetchProjected,
    triggerSync,
    retrySync,
    setEnabled,
  } = useUsageSync();
  const [toggling, setToggling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [retrying, setRetrying] = useState(false);

  async function toggleAutoSync(enabled: boolean) {
    setToggling(true);
    try {
      await setEnabled(enabled);
    } finally {
      setToggling(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      await triggerSync("manual");
      if (status?.attribution === "account") await fetchProjected();
    } finally {
      setSyncing(false);
    }
  }

  async function retryNow() {
    setRetrying(true);
    try {
      await retrySync();
    } finally {
      setRetrying(false);
    }
  }

  const liveRows = projected?.live.rows ?? [];
  const snapshotRows = projected?.snapshot.rows ?? [];
  const offReason = status ? usageSyncOffReasonText(status) : null;
  const hasRetryableSource = status?.sources.some(
    (source) => source.pendingRetry || source.lastError,
  ) ?? false;
  const outcomeLabel = status?.overallOutcome
    ? OUTCOME_LABELS[status.overallOutcome]
    : "Not synced";

  return (
    <div className="stack">
      <h3>Usage Sync</h3>

      <div className="usage-sharing-summary">
        <div className="usage-sharing-block">
          <h4>What uploads</h4>
          <p className="text-muted text-sm">
            Aggregate counters in bounded windows: source, provider, model, effort, subscription tier
            and source, optional plan name, request, token, error, cost, duration, time-to-first-token,
            and plan-utilization totals with reset timing.
          </p>
        </div>
        <div className="usage-sharing-block">
          <h4>What never uploads</h4>
          <p className="text-muted text-sm">
            Prompts, responses, reasoning, tool arguments, source code, terminal output, file or
            repository paths, URLs, account labels, credentials, authentication tokens, secrets, or
            hardware identifiers.
          </p>
        </div>
      </div>

      {status ? (
        <div className="usage-attribution" title="Usage attribution for future accepted uploads">
          {status.attribution === "account" ? <User size={14} /> : <ShieldCheck size={14} />}
          <div>
            <strong className="text-sm">
              {status.attribution === "account" ? "Account attribution" : "Private installation attribution"}
            </strong>
            <p className="text-muted text-sm">
              {status.attribution === "account"
                ? "Accepted usage is attributed to your signed-in basebuild.net account."
                : "Accepted usage is attributed only to this private installation. It is not a hardware ID and is not merged into an account later."}
            </p>
          </div>
        </div>
      ) : null}

      {offReason ? (
        <p className="usage-sync-off text-sm" title="Why usage sync is currently off">
          <AlertCircle size={14} /> {offReason}
        </p>
      ) : null}

      <div className="row gap-sm flex-wrap">
        <label className="row gap-sm">
          <input
            type="checkbox"
            checked={status?.enabled ?? false}
            disabled={toggling}
            onChange={(event) => void toggleAutoSync(event.target.checked)}
            title="Sync usage automatically: periodically and shortly after usage changes"
          />
          <span className="text-sm">Sync usage automatically (periodically &amp; on changes)</span>
        </label>
        <button
          className="btn btn-sm"
          type="button"
          title="Sync aggregate usage now"
          disabled={syncing || retrying || !status?.gatesPass}
          onClick={() => void syncNow()}
        >
          <RefreshCw size={12} /> {syncing ? "Syncing..." : "Sync now"}
        </button>
        {hasRetryableSource ? (
          <button
            className="btn btn-sm"
            type="button"
            title="Retry pending usage sources now"
            disabled={syncing || retrying || !status?.gatesPass}
            onClick={() => void retryNow()}
          >
            <RotateCcw size={12} /> {retrying ? "Retrying..." : "Retry sync"}
          </button>
        ) : null}
        {status?.lastSyncAt ? (
          <span className="text-muted text-sm">
            Last sync: {formatSyncTime(status.lastSyncAt)}
          </span>
        ) : null}
      </div>

      {status ? (
        <section className="usage-source-section" aria-labelledby="usage-source-heading">
          <div className="row-between">
            <h4 id="usage-source-heading">Source status</h4>
            <span
              className={`usage-sync-outcome is-${status.overallOutcome ?? "idle"}`}
              title="Result of the most recent coordinated sync"
            >
              {outcomeLabel}
            </span>
          </div>
          {status.sources.length > 0 ? (
            <div className="usage-source-list">
              {status.sources.map((source) => {
                const state = sourceState(source);
                return (
                  <div className="usage-source-row" key={source.source}>
                    <div className="usage-source-name">
                      {state.className === "is-ok" ? <CheckCircle2 size={14} /> : null}
                      {state.className === "is-warning" ? <Clock3 size={14} /> : null}
                      {state.className === "is-error" ? <AlertCircle size={14} /> : null}
                      {state.className === "is-muted" ? <ShieldCheck size={14} /> : null}
                      <strong className="text-sm">{SOURCE_LABELS[source.source]}</strong>
                    </div>
                    <span className={`usage-source-state ${state.className}`}>{state.label}</span>
                    <div className="usage-source-detail text-muted text-sm">
                      <span>Last success: {formatSyncTime(source.lastSuccessAt)}</span>
                      {source.lastProcessedAt ? (
                        <span>Processed: {formatSyncTime(source.lastProcessedAt)}</span>
                      ) : null}
                      {source.availabilityReason ? <span>{source.availabilityReason}</span> : null}
                      {source.lastError ? (
                        <span className="text-danger" title={source.lastError}>
                          {source.lastError}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted text-sm">Source status will appear after the coordinator starts.</p>
          )}
        </section>
      ) : null}

      {status?.lastError ? (
        <p className="text-danger text-sm" title={status.lastError}>
          Last coordinator error: {status.lastError}
        </p>
      ) : null}
      {lastSyncResult ? (
        <p className={`text-sm ${lastSyncResult.ok ? "text-muted" : "text-danger"}`} title={lastSyncResult.message}>
          {lastSyncResult.ok ? "Success: " : "Failed: "}
          {lastSyncResult.message}
        </p>
      ) : null}
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      {loading ? <p className="text-muted text-sm">Loading...</p> : null}

      {liveRows.length > 0 ? (
        <div className="card">
          <h4>Live Utilization</h4>
          {liveRows.map((row) => {
            const pct = Math.round(row.usedFraction * 100);
            return (
              <div
                key={`${row.provider}-${row.window}`}
                className={`usage-window-row ${row.isStale ? "is-stale" : ""}`}
                title={`${row.provider} ${row.window}: ${pct}% used${row.resetsAt ? `, resets ${row.resetsAt}` : ""}${row.isStale ? ", stale" : ""}`}
              >
                <span className="text-sm">{row.provider} · {row.window}</span>
                <div className="usage-window-bar">
                  <div className="usage-window-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-sm">{pct}%</span>
                {row.isStale ? <span className="text-muted text-sm">stale</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {snapshotRows.length > 0 ? (
        <div className="card">
          <h4>Per-Model Usage (last 7 days)</h4>
          <table className="usage-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model</th>
                <th>Req/day</th>
                <th>Hrs/day</th>
                <th>$/day</th>
              </tr>
            </thead>
            <tbody>
              {snapshotRows.map((row) => (
                <tr key={`${row.provider}-${row.model}`}>
                  <td>{row.provider}</td>
                  <td>{row.model}</td>
                  <td>{Math.round(row.requestsPerDay)}</td>
                  <td>{row.hoursPerDay.toFixed(1)}</td>
                  <td>{row.costPerDay != null ? `$${row.costPerDay.toFixed(2)}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {status?.attribution === "account" ? (
        <ProviderPlansPanel gatesPass={status.gatesPass} />
      ) : null}
    </div>
  );
}

function ProviderPlansPanel({ gatesPass }: { gatesPass: boolean }) {
  const [detected, setDetected] = useState<DetectedProviderPlan[]>([]);
  const [catalog, setCatalog] = useState<Map<string, ProviderPlanOption[]>>(new Map());
  const [selections, setSelections] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, c] = await Promise.all([usageDetectProviderPlans(), usageListProviderPlans()]);
      setDetected(d);
      const byProvider = new Map<string, ProviderPlanOption[]>();
      for (const opt of c) {
        const arr = byProvider.get(opt.provider) ?? [];
        arr.push(opt);
        byProvider.set(opt.provider, arr);
      }
      setCatalog(byProvider);
      // Pre-select volume-inferred plans (match the inferred plan name to a
      // catalog option) so the user can confirm the prediction with one click.
      const seeded = new Map<string, string>();
      for (const dp of d) {
        if (!dp.needsDeclaration || !dp.detectedPlanType) continue;
        const match = (byProvider.get(dp.provider) ?? []).find(
          (o) => o.name.toLowerCase() === dp.detectedPlanType!.toLowerCase(),
        );
        if (match) seeded.set(dp.provider, match.id);
      }
      if (seeded.size > 0) setSelections(seeded);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function pickPlan(provider: string, planId: string) {
    setSelections((prev) => {
      const next = new Map(prev);
      if (planId) {
        next.set(provider, planId);
      } else {
        next.delete(provider);
      }
      return next;
    });
  }

  async function savePlans() {
    if (selections.size === 0) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const plans: Record<string, string> = {};
      for (const [provider, planId] of selections) {
        plans[provider] = planId;
      }
      const msg = await usageDeclareProviderPlans(plans);
      setMessage(msg);
      setSelections(new Map());
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (detected.length === 0 && !loading) return null;

  return (
    <div className="card">
      <h4>Provider Plans</h4>
      <p className="text-muted text-sm">
        Detected natively from your provider credentials. Providers whose API does not expose a plan
        show a picker. Declaring your exact plan gives basebuild.net a 100%-confidence attribution
        instead of a guess.
      </p>
      {!gatesPass ? (
        <p className="text-muted text-sm">
          Turn on Share anonymous aggregate usage to sync declared plans.
        </p>
      ) : null}
      {loading ? <p className="text-muted text-sm">Detecting…</p> : null}
      {detected.map((d) => {
        const options = catalog.get(d.provider) ?? [];
        return (
          <div key={d.provider} className="stack gap-xs">
            <div className="usage-plan-row row gap-sm flex-wrap" title={`${d.provider}: ${d.source}`}>
              <span className="text-sm usage-plan-provider">{d.provider}</span>
              {d.needsDeclaration ? (
                <select
                  className="input input-sm"
                  value={selections.get(d.provider) ?? ""}
                  disabled={saving || options.length === 0}
                  onChange={(e) => pickPlan(d.provider, e.target.value)}
                  title={`Declare your ${d.provider} plan`}
                >
                  <option value="">
                    {options.length === 0 ? "No catalog plans" : "Select your plan…"}
                  </option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <span className="text-sm" title={`Detected via ${d.source}`}>
                  ✓ {d.detectedPlanType ?? "detected"}
                  <span className="text-muted"> · {d.source === "native" ? "native credential" : d.source}</span>
                </span>
              )}
              {d.confidence === "inferred" ? (
                <span className="text-muted text-sm" title="Predicted from usage volume, not provider-confirmed">
                  inferred
                </span>
              ) : null}
            </div>
            {d.note ? <p className="text-muted text-sm">{d.note}</p> : null}
          </div>
        );
      })}
      {selections.size > 0 ? (
        <button
          className="btn btn-sm"
          type="button"
          disabled={saving || !gatesPass}
          onClick={() => void savePlans()}
          title="Save declared plans to basebuild.net"
        >
          {saving ? "Saving…" : `Save ${selections.size} plan${selections.size === 1 ? "" : "s"}`}
        </button>
      ) : null}
      {message ? <p className="text-muted text-sm">✓ {message}</p> : null}
      {error ? <p className="text-danger text-sm">{error}</p> : null}
    </div>
  );
}
