import { useCallback, useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock3, LogOut, RefreshCw, RotateCcw, ShieldCheck, User } from "lucide-react";
import { authStartDeviceFlow, authPollDeviceFlow } from "../../../lib/auth";
import type { AccountState } from "../../../state/account";
import { SkeletonControl, SkeletonRows, SkeletonText } from "../Loading";
import { useUsageSync } from "../../../state/usageSync";
import {
  usageDetectProviderPlans,
  usageDrainRates,
  usageListProviderPlans,
  usageDeclareProviderPlans,
} from "../../../lib/usageSync";
import type {
  AutoSyncStatus,
  DetectedProviderPlan,
  DrainEstimate,
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
  native: "Basebuild chat",
  omp: "Oh My Pi",
  "claude-code": "Claude Code",
  codex: "Codex CLI",
  opencode: "OpenCode",
};

/// What each source contributes, shown as the row tooltip. "OMP" and
/// "Basebuild" alone did not say which usage a row actually covers.
const SOURCE_HINTS: Record<UsageSyncSource, string> = {
  native: "chats you run inside Basebuild",
  omp: "usage reported by the Oh My Pi CLI",
  "claude-code": "usage recorded by Claude Code sessions",
  codex: "usage recorded by the Codex CLI",
  opencode: "usage recorded by OpenCode sessions",
};

const OUTCOME_LABELS: Record<SyncOverallOutcome, string> = {
  success: "Synced",
  partial: "Partial",
  failed: "Failed",
  nothing_to_sync: "Up to date",
};

export function usageSyncOffReasonText(status: AutoSyncStatus): string | null {
  // The backoff window is the one "off" reason that keeps the gates open:
  // the schedule is waiting, but Sync now / Retry sync still work.
  if (status.offReason === "retry_backoff") {
    const at = status.retryAfter ? formatSyncTime(status.retryAfter) : null;
    return at
      ? `A previous attempt failed. The next scheduled retry is at ${at} — or retry now.`
      : "A previous attempt failed. A retry is waiting for its backoff window.";
  }
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
    default:
      return "Usage sync is off. Review Share anonymous aggregate usage below.";
  }
}

/// One line per source: a state word and a single supporting detail.
/// Previously `pendingRetry` and `lastError` produced two different labels
/// ("Retry pending" / "Needs attention") for the same condition, and an
/// available source with no data yet read as "Ready" forever.
function sourceState(source: SourceSyncStatus): {
  label: string;
  className: string;
  detail: string;
} {
  if (!source.available) {
    return {
      label: "Not installed",
      className: "is-muted",
      detail: source.availabilityReason ?? "No local usage store found",
    };
  }
  if (source.lastError || source.pendingRetry) {
    return {
      label: "Retrying",
      className: "is-warning",
      detail: source.lastError ?? "Queued for the next attempt",
    };
  }
  // Queued work is the difference between "caught up" and "we just haven't
  // sent your last message yet" — reporting both as "no new usage" is what
  // made the panel look stuck right after sending a message.
  const queued = source.pendingRequests ?? 0;
  const queuedText = `${queued} request${queued === 1 ? "" : "s"} waiting for the next sync`;
  if (source.lastSuccessAt) {
    return {
      label: "Synced",
      className: "is-ok",
      detail: queued
        ? `${formatRelativeTime(source.lastSuccessAt)} · ${queuedText}`
        : formatRelativeTime(source.lastSuccessAt),
    };
  }
  if (queued) {
    return { label: "Queued", className: "is-warning", detail: queuedText };
  }
  return { label: "Waiting", className: "is-muted", detail: "No new usage yet" };
}

function formatSyncTime(timestamp?: number): string {
  return timestamp ? new Date(timestamp * 1000).toLocaleString() : "Never";
}

/// "2 minutes ago" reads faster than a locale timestamp in a status list.
/// The absolute time stays available as the row's tooltip.
function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return "just now";
  const units: [number, string][] = [
    [86400 * 7, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    const value = Math.floor(seconds / size);
    if (value >= 1) return `${value} ${name}${value === 1 ? "" : "s"} ago`;
  }
  return "just now";
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
      ) : (
        <SkeletonRows rows={2} label="Loading usage attribution…" />
      )}

      {offReason ? (
        <p className="usage-sync-off text-sm" title="Why usage sync is currently off">
          <AlertCircle size={14} /> {offReason}
        </p>
      ) : null}

      <div className="row gap-sm flex-wrap">
        <label className="row gap-sm">
          {/* An unchecked box is not a neutral placeholder — it reads as
              "auto-sync is off". Stand in until the real value arrives. */}
          {status ? (
            <input
              type="checkbox"
              checked={status.enabled}
              disabled={toggling}
              onChange={(event) => void toggleAutoSync(event.target.checked)}
              title="Sync usage automatically: periodically and shortly after usage changes"
            />
          ) : (
            <SkeletonControl label="the automatic sync setting" />
          )}
          <span className="text-sm">Sync usage automatically (periodically &amp; on changes)</span>
        </label>
        <button
          className="btn btn-sm"
          type="button"
          title={status ? "Sync aggregate usage now" : "Loading sync status…"}
          disabled={!status || syncing || retrying || !status.gatesPass}
          onClick={() => void syncNow()}
        >
          <RefreshCw size={12} className={syncing ? "spin" : undefined} />{" "}
          {syncing ? "Syncing..." : "Sync now"}
        </button>
        {hasRetryableSource ? (
          <button
            className="btn btn-sm"
            type="button"
            title="Retry pending usage sources now"
            disabled={syncing || retrying || !status?.gatesPass}
            onClick={() => void retryNow()}
          >
            <RotateCcw size={12} className={retrying ? "spin" : undefined} />{" "}
            {retrying ? "Retrying..." : "Retry sync"}
          </button>
        ) : null}
        {!status ? (
          <span className="text-muted text-sm">
            Last sync: <SkeletonText width={14} />
          </span>
        ) : status.lastSyncAt ? (
          <span className="text-muted text-sm">
            Last sync: {formatSyncTime(status.lastSyncAt)}
          </span>
        ) : null}
      </div>

      {/* The section frame renders unconditionally. Hiding the whole thing
          until `status` arrived is what made it pop in from nowhere. */}
      <section className="usage-source-section" aria-labelledby="usage-source-heading">
        <div className="row-between">
          <h4 id="usage-source-heading">Source status</h4>
          <span
            className={`usage-sync-outcome is-${status?.overallOutcome ?? "idle"}`}
            title="Result of the most recent coordinated sync"
          >
            {status ? outcomeLabel : "Checking…"}
          </span>
        </div>
        <p className="text-muted text-sm">
          Every local tool Basebuild can read usage from. Installed tools are
          listed first; the rest are shown so you can see what would be picked up.
        </p>
        {!status ? (
          <SkeletonRows rows={5} label="Loading source status…" />
        ) : status.sources.length > 0 ? (
          <div className="usage-source-list">
            {[...status.sources]
              .sort((a, b) =>
                a.available !== b.available
                  ? Number(b.available) - Number(a.available)
                  : SOURCE_LABELS[a.source].localeCompare(SOURCE_LABELS[b.source]),
              )
              .map((source) => {
                const state = sourceState(source);
                return (
                  <div
                    className={`usage-source-row ${source.available ? "" : "is-unavailable"}`}
                    key={source.source}
                    title={`${SOURCE_LABELS[source.source]} — ${SOURCE_HINTS[source.source]}. Last accepted upload: ${formatSyncTime(source.lastSuccessAt)}`}
                  >
                    <div className="usage-source-name">
                      {state.className === "is-ok" ? <CheckCircle2 size={14} /> : null}
                      {state.className === "is-warning" ? <Clock3 size={14} /> : null}
                      {state.className === "is-error" ? <AlertCircle size={14} /> : null}
                      {state.className === "is-muted" ? <ShieldCheck size={14} /> : null}
                      <strong className="text-sm">{SOURCE_LABELS[source.source]}</strong>
                    </div>
                    <span className={`usage-source-state ${state.className}`}>{state.label}</span>
                    <span
                      className={`usage-source-detail text-sm ${
                        state.className === "is-warning" || state.className === "is-error"
                          ? "text-danger"
                          : "text-muted"
                      }`}
                    >
                      {state.detail}
                    </span>
                  </div>
                );
              })}
          </div>
        ) : (
          <p className="text-muted text-sm">Source status will appear after the coordinator starts.</p>
        )}
      </section>

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

      <PlanBurnRatePanel />

      {/* Account-only cards. While `projected` is in flight the card frame
          stays put so the panel does not grow by two cards on arrival. */}
      {status?.attribution === "account" && !projected && !error ? (
        <div className="card">
          <h4>Live Utilization</h4>
          <SkeletonRows rows={3} label="Loading live utilization…" />
        </div>
      ) : null}

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

      {status?.attribution === "account" && !projected && !error ? (
        <div className="card">
          <h4>Per-Model Usage (last 7 days)</h4>
          <SkeletonRows rows={4} label="Loading per-model usage…" />
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

const CONFIDENCE_LABELS: Record<DrainEstimate["confidence"], string> = {
  high: "measured",
  medium: "approximate",
  low: "estimate",
};

const CONFIDENCE_HINTS: Record<DrainEstimate["confidence"], string> = {
  high: "Several solved intervals agree on this rate.",
  medium: "Few intervals, or they disagree somewhat — read the rate as approximate.",
  low: "Too little agreeing evidence to call this a measurement. It is an estimate.",
};

/// A window fraction per 1000 tokens is ~2e-6 — a number nobody can read.
/// A million tokens is the unit a user reasons in, and percent is the unit the
/// plan window is already shown in, so the rate becomes "x% of the window per
/// 1M tokens": fraction/1k × 1000 tokens × 100 percent.
function formatWindowPercentPerMillionTokens(fractionPer1kTokens: number): string {
  const percent = fractionPer1kTokens * 1000 * 100;
  if (!Number.isFinite(percent) || percent <= 0) return "—";
  const decimals = percent >= 10 ? 0 : percent >= 1 ? 1 : percent >= 0.1 ? 2 : 3;
  return `${percent.toFixed(decimals)}%`;
}

/// The inverse of the per-request window fraction: how many requests of the
/// observed shape the whole window pays for.
function formatRequestsToEmpty(fractionPerRequest: number): string {
  if (!Number.isFinite(fractionPerRequest) || fractionPerRequest <= 0) return "—";
  return Math.round(1 / fractionPerRequest).toLocaleString();
}

/// Locally-solved plan drain. Two quota readings that bracket measured traffic
/// give an observed "what did that traffic actually cost me" rate. The honest
/// framing lives on the row: a low-confidence rate is labelled an estimate and
/// prefixed with ≈, a window with no second interval shows no spread rather
/// than a fake zero, and a window shared by several models says so — its rate
/// is a blend, not any one model's cost.
function PlanBurnRatePanel() {
  const [estimates, setEstimates] = useState<DrainEstimate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEstimates(await usageDrainRates());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="usage-burn-section" aria-labelledby="usage-burn-heading">
      <h4 id="usage-burn-heading">Plan burn rate</h4>
      <p className="text-muted text-sm">
        Solved on this machine by pairing two readings of a provider quota window against the
        traffic measured between them. Rates are observed, not published by the provider.
      </p>
      {loading && estimates.length === 0 && !error ? (
        <SkeletonRows rows={2} label="Loading plan burn rates…" />
      ) : null}
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      {!loading && !error && estimates.length === 0 ? (
        <p className="text-muted text-sm">
          No rates yet. One appears once two readings of the same quota window bracket some
          traffic, so a plan-limited provider needs a little more use before there is anything to
          measure.
        </p>
      ) : null}
      {estimates.length > 0 ? (
        <div className="usage-burn-list">
          {estimates.map((estimate) => {
            const remainingPct = Math.round(estimate.remainingFraction * 100);
            const emptiesBeforeReset =
              estimate.projectedExhaustionAt != null &&
              estimate.resetsAt != null &&
              estimate.projectedExhaustionAt < estimate.resetsAt;
            const shared = estimate.models.length > 1;
            // A low-confidence rate must never read as a measured figure.
            const approx = estimate.confidence === "low" ? "≈" : "";
            const intervalWord = estimate.intervals === 1 ? "interval" : "intervals";
            return (
              <div
                key={`${estimate.provider}:${estimate.limitId}:${estimate.modelId ?? "shared"}`}
                className={`usage-burn-row ${emptiesBeforeReset ? "is-exhausting" : ""}`}
                title={`${estimate.provider}${estimate.windowLabel ? ` ${estimate.windowLabel}` : ""} (${estimate.limitId}): ${remainingPct}% of the window left. Solved from ${estimate.intervals} ${intervalWord} covering ${estimate.requests.toLocaleString()} requests and ${estimate.totalTokens.toLocaleString()} tokens, last observed ${new Date(estimate.observedAt).toLocaleString()}.`}
              >
                <div className="usage-burn-head">
                  <strong className="text-sm">{estimate.provider}</strong>
                  {estimate.windowLabel ? (
                    <span className="usage-burn-window">{estimate.windowLabel}</span>
                  ) : null}
                  {estimate.planType ? (
                    <span className="text-muted text-sm">{estimate.planType}</span>
                  ) : null}
                  <span
                    className={`usage-burn-confidence is-${estimate.confidence}`}
                    title={CONFIDENCE_HINTS[estimate.confidence]}
                  >
                    {CONFIDENCE_LABELS[estimate.confidence]}
                  </span>
                </div>

                <div className="usage-burn-scope">
                  {estimate.modelId ??
                    (estimate.models.length > 0
                      ? estimate.models.join(" · ")
                      : "every model on this window")}
                </div>

                <div className="usage-burn-stats">
                  <span className="usage-burn-stat" title="Share of the window still available">
                    <span className="usage-burn-stat-label">Left</span>
                    <span className="usage-burn-stat-value">{remainingPct}%</span>
                  </span>
                  <span
                    className="usage-burn-stat"
                    title="Share of this window consumed per million tokens, at the observed rate"
                  >
                    <span className="usage-burn-stat-label">Per 1M tokens</span>
                    <span className="usage-burn-stat-value">
                      {approx}
                      {formatWindowPercentPerMillionTokens(estimate.fractionPer1kTokens)}
                    </span>
                  </span>
                  <span
                    className="usage-burn-stat"
                    title="Requests the full window pays for, at the observed cost per request"
                  >
                    <span className="usage-burn-stat-label">Requests to empty</span>
                    <span className="usage-burn-stat-value">
                      {approx}
                      {formatRequestsToEmpty(estimate.fractionPerRequest)}
                    </span>
                  </span>
                  <span
                    className="usage-burn-stat"
                    title={
                      estimate.relativeSpread == null
                        ? "No spread yet — a second solved interval is needed to compare"
                        : "How much the solved intervals disagree with each other"
                    }
                  >
                    <span className="usage-burn-stat-label">Spread</span>
                    <span className="usage-burn-stat-value">
                      {estimate.relativeSpread == null
                        ? "—"
                        : `±${Math.round(estimate.relativeSpread * 100)}%`}
                    </span>
                  </span>
                  <span className="usage-burn-stat" title="Solved intervals backing this rate">
                    <span className="usage-burn-stat-label">Samples</span>
                    <span className="usage-burn-stat-value">{estimate.intervals}</span>
                  </span>
                </div>

                {estimate.projectedExhaustionAt != null || estimate.resetsAt != null ? (
                  <div className="usage-burn-times">
                    {estimate.projectedExhaustionAt != null ? (
                      <span>Empties {new Date(estimate.projectedExhaustionAt).toLocaleString()}</span>
                    ) : null}
                    {estimate.resetsAt != null ? (
                      <span>Resets {new Date(estimate.resetsAt).toLocaleString()}</span>
                    ) : null}
                  </div>
                ) : null}

                {emptiesBeforeReset ? (
                  <p className="usage-burn-note text-danger text-sm">
                    <AlertTriangle size={13} /> At this rate the window empties before it resets.
                  </p>
                ) : null}
                {estimate.confidence === "low" ? (
                  <p className="usage-burn-note is-estimate text-sm">
                    <AlertCircle size={13} /> Estimate, not a measurement: {estimate.intervals}{" "}
                    {intervalWord} solved so far.
                  </p>
                ) : null}
                {shared ? (
                  <p className="text-muted text-sm">
                    Shared window — this rate is a blend across {estimate.models.length} models, not
                    the cost of any one of them.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
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
