import { useCallback, useEffect, useState } from "react";
import { LogOut, RefreshCw, User } from "lucide-react";
import { authStartDeviceFlow, authPollDeviceFlow } from "../../../lib/auth";
import type { AccountState } from "../../../state/account";
import { useUsageSync } from "../../../state/usageSync";
import {
  usageDetectProviderPlans,
  usageListProviderPlans,
  usageDeclareProviderPlans,
} from "../../../lib/usageSync";
import type { DetectedProviderPlan, ProviderPlanOption } from "../../../lib/usageSync";

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

export function UsageSyncPanel() {
  const { status, projected, loading, error, lastSyncResult, fetchProjected, triggerSync, setEnabled, setMode } =
    useUsageSync();
  const [toggling, setToggling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [savingMode, setSavingMode] = useState(false);

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
      await fetchProjected();
    } finally {
      setSyncing(false);
    }
  }

  async function changeMode(mode: "rows" | "summary") {
    setSavingMode(true);
    try {
      await setMode(mode);
    } finally {
      setSavingMode(false);
    }
  }

  const liveRows = projected?.live.rows ?? [];
  const snapshotRows = projected?.snapshot.rows ?? [];

  return (
    <div className="stack">
      <h3>Usage Sync</h3>
      <p className="text-muted text-sm">
        Sync your usage to basebuild.net so your dashboard shows what provider, model, and
        subscription each message used. The app sends only aggregated usage stats (model,
        provider, subscription tier, tokens, cost, timing) — never prompts, source code, or secrets.
      </p>
      {status && !status.gatesPass ? (
        <p className="text-danger text-sm" title="Usage upload is currently off">
          Syncing is paused — turn on &quot;Enable anonymous upload&quot; in Settings → Privacy to allow usage upload. Until then, Auto-sync and Sync now do nothing.
        </p>
      ) : null}

      <div className="row gap-sm flex-wrap">
        <label className="row gap-sm">
          <input
            type="checkbox"
            checked={status?.enabled ?? false}
            disabled={toggling}
            onChange={(e) => void toggleAutoSync(e.target.checked)}
            title="Enable hourly auto-sync to basebuild.net"
          />
          <span className="text-sm">Auto-sync every {status?.intervalMinutes ?? 60} min</span>
        </label>
        <button
          className="btn btn-sm"
          type="button"
          title="Sync usage now"
          disabled={syncing}
          onClick={() => void syncNow()}
        >
          <RefreshCw size={12} /> Sync now
        </button>
        {status?.lastSyncAt ? (
          <span className="text-muted text-sm">
            Last sync: {new Date((status.lastSyncAt ?? 0) * 1000).toLocaleString()}
          </span>
        ) : null}
      </div>

      <div className="row gap-sm flex-wrap">
        <label className="text-sm" htmlFor="usage-sync-mode">Detail level</label>
        <select
          id="usage-sync-mode"
          className="input input-sm"
          value={status?.syncMode === "summary" ? "summary" : "rows"}
          disabled={savingMode}
          onChange={(e) => void changeMode(e.target.value === "summary" ? "summary" : "rows")}
          title="How much usage detail the app sends to basebuild.net"
        >
          <option value="rows">Full message rows — server rolls up (recommended)</option>
          <option value="summary">Client summaries — lighter, less detail</option>
        </select>
      </div>

      {status?.lastError ? (
        <p className="text-danger text-sm" title={status.lastError}>
          Last error: {status.lastError}
        </p>
      ) : null}
      {lastSyncResult ? (
        <p className={`text-sm ${lastSyncResult.ok ? "text-muted" : "text-danger"}`} title={lastSyncResult.message}>
          {lastSyncResult.ok ? "✓ " : "✗ "}
          {lastSyncResult.message}
        </p>
      ) : null}
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      {loading ? <p className="text-muted text-sm">Loading…</p> : null}

      {liveRows.length > 0 ? (
        <div className="card">
          <h4>Live Utilization</h4>
          {liveRows.map((r) => {
            const pct = Math.round(r.usedFraction * 100);
            return (
              <div
                key={`${r.provider}-${r.window}`}
                className={`usage-window-row ${r.isStale ? "is-stale" : ""}`}
                title={`${r.provider} ${r.window}: ${pct}% used${r.resetsAt ? ` · resets ${r.resetsAt}` : ""}${r.isStale ? " · stale" : ""}`}
              >
                <span className="text-sm">{r.provider} · {r.window}</span>
                <div className="usage-window-bar">
                  <div className="usage-window-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-sm">{pct}%</span>
                {r.isStale ? <span className="text-muted text-sm">stale</span> : null}
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
              {snapshotRows.map((r) => (
                <tr key={`${r.provider}-${r.model}`}>
                  <td>{r.provider}</td>
                  <td>{r.model}</td>
                  <td>{Math.round(r.requestsPerDay)}</td>
                  <td>{r.hoursPerDay.toFixed(1)}</td>
                  <td>{r.costPerDay != null ? `$${r.costPerDay.toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ProviderPlansPanel gatesPass={status?.gatesPass ?? false} />
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
        Detected natively from your provider credentials. Providers we can&apos;t detect (their API
        doesn&apos;t expose the plan) show a picker — declaring your exact plan gives basebuild.net a
        100%-confidence attribution instead of a guess.
      </p>
      {!gatesPass ? (
        <p className="text-muted text-sm">
          Enable usage upload in Settings → Privacy to sync declared plans.
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
