import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, LogOut, RefreshCw, RotateCcw, ShieldCheck, User } from "lucide-react";
import { authStartDeviceFlow, authPollDeviceFlow } from "../../../lib/auth";
import type { AccountState } from "../../../state/account";
import { SkeletonControl, SkeletonRows, SkeletonText } from "../Loading";
import { useUsageSync } from "../../../state/usageSync";
import {
  usageDetectProviderPlans,
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
import { t } from "../../../i18n";
import { formatDateTime, formatRelativeTime } from "../../../i18n/format";

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
        clientName: t("accountTab.basebuildDesktop"),
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
            setError(t("accountTab.signInWasDenied"));
            setPolling(false);
            setDeviceCode(null);
          } else {
            setError(t("accountTab.theSignInCodeExpiredPlease"));
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
    return <p className="text-muted">{t("accountTab.loadingAccount")}</p>;
  }

  if (account.profile) {
    return (
      <div className="stack">
        <h3>{t("accountTab.account")}</h3>
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
          title={t("accountTab.signOutAndRevokeThis")}
          onClick={() => void account.signOut()}
        >
          <LogOut size={12} /> {t("accountTab.signOut")}
        </button>
        {error ? <p className="text-danger text-sm">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="stack">
      <h3>{t("accountTab.account")}</h3>
      <p className="text-muted text-sm">
        {t("accountTab.signInWithYourBasebuild")}
      </p>
      {polling ? (
        <p className="text-muted text-sm">{t("accountTab.waitingForBrowserApprovalCheck")}</p>
      ) : (
        <button
          className="btn btn-primary"
          type="button"
          title={t("accountTab.openBrowserToSignIn")}
          onClick={() => void signIn()}
        >
          <User size={12} /> {t("accountTab.signIn")}
        </button>
      )}
      {error ? <p className="text-danger text-sm">{error}</p> : null}
    </div>
  );
}

function SOURCE_LABELS(): Record<UsageSyncSource, string> {
  return {
    native: t("accountTab.basebuildChat"),
    omp: t("accountTab.ohMyPi"),
    "claude-code": t("accountTab.claudeCode"),
    codex: t("accountTab.codexCli"),
    opencode: t("accountTab.opencode"),
  };
}

/// What each source contributes, shown as the row tooltip. "OMP" and
/// "Basebuild" alone did not say which usage a row actually covers.
function SOURCE_HINTS(): Record<UsageSyncSource, string> {
  return {
    native: t("accountTab.chatsYouRunInsideBasebuild"),
    omp: t("accountTab.usageReportedByTheOhMy"),
    "claude-code": t("accountTab.usageRecordedByClaudeCodeSessions"),
    codex: t("accountTab.usageRecordedByTheCodexCli"),
    opencode: t("accountTab.usageRecordedByOpencodeSessions"),
  };
}

function OUTCOME_LABELS(): Record<SyncOverallOutcome, string> {
  return {
    success: t("accountTab.outcomeLabelsSuccess"),
    partial: t("accountTab.partial"),
    failed: t("accountTab.failed2"),
    nothing_to_sync: t("accountTab.upToDate"),
  };
}

export function usageSyncOffReasonText(status: AutoSyncStatus): string | null {
  // The backoff window is the one "off" reason that keeps the gates open:
  // the schedule is waiting, but Sync now / Retry sync still work.
  if (status.offReason === "retry_backoff") {
    const at = status.retryAfter ? formatSyncTime(status.retryAfter) : null;
    return at
      ? t("accountTab.aPreviousAttemptFailedTheNext", { at })
      : t("accountTab.aPreviousAttemptFailedARetry");
  }
  if (status.gatesPass) return null;
  switch (status.offReason) {
    case "usage_sharing_disabled":
      return t("accountTab.usageSharingIsOffTurnOn");
    case "auto_sync_disabled":
      return t("accountTab.autoSyncIsOffTurnIt");
    case "consent_required":
      return t("accountTab.usageSharingIsnTOnYet");
    case "no_sources_available":
      return t("accountTab.noSupportedLocalUsageSourcesAre");
    default:
      return t("accountTab.usageSyncIsOffReviewShare");
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
      label: t("accountTab.notInstalled"),
      className: "is-muted",
      detail: source.availabilityReason ?? t("accountTab.noLocalUsageStoreFound"),
    };
  }
  if (source.lastError || source.pendingRetry) {
    return {
      label: t("accountTab.retrying2"),
      className: "is-warning",
      detail: source.lastError ?? t("accountTab.queuedForTheNextAttempt"),
    };
  }
  // Queued work is the difference between "caught up" and "we just haven't
  // sent your last message yet" — reporting both as "no new usage" is what
  // made the panel look stuck right after sending a message.
  const queued = source.pendingRequests ?? 0;
  const queuedText = queued === 1 ? t("accountTab.requestsWaitingOne", { count: queued }) : t("accountTab.requestsWaitingOther", { count: queued });
  if (source.lastSuccessAt) {
    return {
      label: t("accountTab.synced"),
      className: "is-ok",
      detail: queued
        ? `${formatRelativeTime(source.lastSuccessAt, "long")} · ${queuedText}`
        : formatRelativeTime(source.lastSuccessAt, "long"),
    };
  }
  if (queued) {
    return { label: t("accountTab.queued"), className: "is-warning", detail: queuedText };
  }
  return { label: t("accountTab.waiting"), className: "is-muted", detail: t("accountTab.noNewUsageYet") };
}

function formatSyncTime(timestamp?: number): string {
  return timestamp ? formatDateTime(new Date(timestamp * 1000)) : t("accountTab.never");
}

function formatUsageWindowLabel(window: string): string {
  if (window === "7d") return t("accountTab.weekly7d");
  if (window === "1d" || window === "24h") return t("accountTab.daily", { window });
  if (/^\d+h$/.test(window)) return t("accountTab.session", { window });
  if (/^(28|30|31)d$/.test(window)) return t("accountTab.monthly", { window });
  return window;
}

/// Drain per request is a window fraction, and the interesting values are
/// small: 0.12% of a weekly window per request reads as "0%" at one decimal.
function formatDrainPercent(fraction: number): string {
  const percent = fraction * 100;
  if (percent <= 0) return "0%";
  if (percent < 0.01) return "<0.01%";
  if (percent < 1) return `${percent.toFixed(2)}%`;
  return `${percent.toFixed(1)}%`;
}

function formatRequestCount(requests: number): string {
  if (!Number.isFinite(requests) || requests <= 0) return "0";
  if (requests < 1000) return String(Math.round(requests));
  return `${(requests / 1000).toFixed(1)}k`;
}

/// Model-hours consumed. Concurrent requests add, so this is not wall clock
/// and can exceed the window's own length.
function formatModelHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0m";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}

/// "in 3 hours" answers the question the row is asking. An absolute timestamp
/// makes the reader do the subtraction.
function formatCountdown(epochMs: number): string {
  const seconds = Math.round((epochMs - Date.now()) / 1000);
  if (seconds <= 0) return "now";
  if (seconds < 3600) return `in ${Math.max(1, Math.round(seconds / 60))}m`;
  if (seconds < 86400) return `in ${(seconds / 3600).toFixed(1)}h`;
  return `in ${Math.round(seconds / 86400)}d`;
}

function formatDrainTooltip(row: DrainEstimate): string {
  const parts = [
    row.intervals === 1 ? t("accountTab.solvedIntervalsOne", { count: row.intervals }) : t("accountTab.solvedIntervalsOther", { count: row.intervals }),
    row.requests === 1 ? t("accountTab.requestsMeasuredOne", { count: row.requests }) : t("accountTab.requestsMeasuredOther", { count: row.requests }),
    t("accountTab.requestsPerFullWindow", { value1: formatRequestCount(row.requestsPerWindow) }),
  ];
  if (row.hoursUsedThisWindow != null) {
    parts.push(
      t("accountTab.ofModelTimeSpentSinceThis", { value1: formatModelHours(row.hoursUsedThisWindow) }),
    );
  }
  if (row.hoursPerWeek != null) {
    parts.push(t("accountTab.hOfModelRuntimePerWeek", { value1: row.hoursPerWeek.toFixed(1) }));
  } else {
    parts.push(t("accountTab.weeklyAllowanceUnknownTheProviderDoes"));
  }
  if (row.models.length > 0) parts.push(t("accountTab.models", { models: row.models.join(", ") }));
  if (row.resetsAt) parts.push(t("accountTab.resets", { v1: formatDateTime(new Date(row.resetsAt)) }));
  return parts.join(" · ");
}

export function UsageSyncPanel() {
  const {
    status,
    projected,
    drain,
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
    ? OUTCOME_LABELS()[status.overallOutcome]
    : t("accountTab.notSynced");

  return (
    <div className="stack">
      <h3>{t("accountTab.usage")}</h3>

      {status?.attribution === "account" && !projected && !error ? (
        <>
          <div className="card">
            <h4>{t("accountTab.sessionAndWeeklyUsage")}</h4>
            <SkeletonRows rows={2} label={t("accountTab.loadingProviderUsageLimits")} />
          </div>
          <div className="card">
            <h4>{t("accountTab.perModelUsage")}</h4>
            <SkeletonRows rows={4} label={t("accountTab.loadingPerModelUsage")} />
          </div>
        </>
      ) : null}

      {liveRows.length > 0 ? (
        <div className="card">
          <h4>{t("accountTab.sessionAndWeeklyUsage")}</h4>
          {liveRows.map((row) => {
            const pct = Math.round(Math.min(1, Math.max(0, row.usedFraction)) * 100);
            const label = formatUsageWindowLabel(row.window);
            return (
              <div
                key={`${row.provider}-${row.window}`}
                className={`usage-window-row ${row.isStale ? "is-stale" : ""}`}
                title={t((row.isStale ? "accountTab.used.stale" : "accountTab.used.none"), { provider: row.provider, label: label, pct: pct, value: row.resetsAt ? t("accountTab.resets2", { resetsAt: row.resetsAt }) : "" })}
              >
                <span className="usage-window-label">
                  <strong className="text-sm">{label}</strong>
                  <span className="text-muted text-sm">{row.provider}</span>
                </span>
                <progress
                  className="usage-window-bar"
                  value={pct}
                  max={100}
                  aria-label={t("accountTab.usage2", { provider: row.provider, label: label })}
                >
                  {pct}%
                </progress>
                <span className="text-sm mono">{pct}%</span>
                {row.isStale ? <span className="text-muted text-sm">{t("accountTab.stale")}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {drain.length > 0 ? (
        <div className="card">
          <h4>{t("accountTab.planDrainRate")}</h4>
          <p className="text-muted text-sm">
            {t("accountTab.solvedOnThisMachineBy")}
          </p>
          <table className="usage-table usage-drain-table">
            <thead>
              <tr>
                <th>{t("accountTab.window")}</th>
                <th>{t("accountTab.left")}</th>
                <th>{t("accountTab.usedThisWindow")}</th>
                <th>{t("accountTab.requestsLeft")}</th>
                <th>{t("accountTab.perRequest")}</th>
                <th>{t("accountTab.runsOut")}</th>
                <th>{t("accountTab.confidence")}</th>
              </tr>
            </thead>
            <tbody>
              {drain.map((row) => (
                <tr
                  key={`${row.provider}-${row.limitId}`}
                  title={formatDrainTooltip(row)}
                >
                  <td>
                    {row.provider}
                    {row.windowLabel ? t("accountTab.text", { windowLabel: row.windowLabel }) : ""}
                    {row.modelId ? t("accountTab.text2", { modelId: row.modelId }) : ""}
                  </td>
                  <td>{Math.round(row.remainingFraction * 100)}%</td>
                  <td>
                    {row.hoursUsedThisWindow == null
                      ? "—"
                      : t("accountTab.req", { hoursUsedThisWindow: formatModelHours(row.hoursUsedThisWindow), requestsUsedThisWindow: formatRequestCount(row.requestsUsedThisWindow) })}
                  </td>
                  <td>{formatRequestCount(row.requestsRemaining)}</td>
                  <td>{formatDrainPercent(row.fractionPerRequest)}</td>
                  <td>
                    {row.projectedExhaustionAt
                      ? formatCountdown(row.projectedExhaustionAt)
                      : t("accountTab.notDraining")}
                  </td>
                  <td className={`usage-drain-confidence is-${row.confidence}`}>
                    {row.confidence}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {snapshotRows.length > 0 ? (
        <div className="card">
          <h4>{t("accountTab.perModelUsage")}</h4>
          <p className="text-muted text-sm">{t("accountTab.dailyAveragesFromTheLast")}</p>
          <table className="usage-table">
            <thead>
              <tr>
                <th>{t("accountTab.provider")}</th>
                <th>{t("accountTab.model")}</th>
                <th>{t("accountTab.reqDay")}</th>
                <th>{t("accountTab.hrsDay")}</th>
                <th>{t("accountTab.day")}</th>
              </tr>
            </thead>
            <tbody>
              {snapshotRows.map((row) => (
                <tr key={`${row.provider}-${row.model}`}>
                  <td>{row.provider}</td>
                  <td>{row.model}</td>
                  <td>{Math.round(row.requestsPerDay)}</td>
                  <td>{row.hoursPerDay.toFixed(1)}</td>
                  <td>{row.costPerDay != null ? t("accountTab.text3", { value: row.costPerDay.toFixed(2) }) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="usage-sharing-summary">
        <div className="usage-sharing-block">
          <h4>{t("accountTab.whatUploads")}</h4>
          <p className="text-muted text-sm">
            {t("accountTab.privacySafeRequestSpansAnd")}
          </p>
        </div>
        <div className="usage-sharing-block">
          <h4>{t("accountTab.whatNeverUploads")}</h4>
          <p className="text-muted text-sm">
            {t("accountTab.promptsResponsesReasoningToolArguments")}
          </p>
        </div>
      </div>

      {status ? (
        <div className="usage-attribution" title={t("accountTab.usageAttributionForFutureAccepted")}>
          {status.attribution === "account" ? <User size={14} /> : <ShieldCheck size={14} />}
          <div>
            <strong className="text-sm">
              {status.attribution === "account" ? t("accountTab.accountAttribution") : t("accountTab.privateInstallationAttribution")}
            </strong>
            <p className="text-muted text-sm">
              {status.attribution === "account"
                ? t("accountTab.acceptedUsageIsAttributedTo")
                : t("accountTab.acceptedUsageIsAttributedOnly")}
            </p>
          </div>
        </div>
      ) : (
        <SkeletonRows rows={2} label={t("accountTab.loadingUsageAttribution")} />
      )}

      {offReason ? (
        <p className="usage-sync-off text-sm" title={t("accountTab.whyUsageSyncIsCurrently")}>
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
              title={t("accountTab.syncUsageAutomaticallyPeriodicallyAnd")}
            />
          ) : (
            <SkeletonControl label={t("accountTab.theAutomaticSyncSetting")} />
          )}
          <span className="text-sm">{t("accountTab.syncUsageAutomaticallyPeriodicallyOn")}</span>
        </label>
        <button
          className="btn btn-sm"
          type="button"
          title={status ? t("accountTab.syncUsageAndQuotaObservations") : t("accountTab.loadingSyncStatus")}
          disabled={!status || syncing || retrying || !status.gatesPass}
          onClick={() => void syncNow()}
        >
          <RefreshCw size={12} className={syncing ? "spin" : undefined} />{" "}
          {syncing ? t("accountTab.syncing") : t("accountTab.syncNow")}
        </button>
        {hasRetryableSource ? (
          <button
            className="btn btn-sm"
            type="button"
            title={t("accountTab.retryPendingUsageSourcesNow")}
            disabled={syncing || retrying || !status?.gatesPass}
            onClick={() => void retryNow()}
          >
            <RotateCcw size={12} className={retrying ? "spin" : undefined} />{" "}
            {retrying ? t("accountTab.retrying") : t("accountTab.retrySync")}
          </button>
        ) : null}
        {!status ? (
          <span className="text-muted text-sm">
            {t("accountTab.lastSync")} <SkeletonText width={14} />
          </span>
        ) : status.lastSyncAt ? (
          <span className="text-muted text-sm">
            {t("accountTab.lastSync2", { lastSyncAt: formatSyncTime(status.lastSyncAt) })}</span>
        ) : null}
      </div>

      {/* The section frame renders unconditionally. Hiding the whole thing
          until `status` arrived is what made it pop in from nowhere. */}
      <section className="usage-source-section" aria-labelledby="usage-source-heading">
        <div className="row-between">
          <h4 id="usage-source-heading">{t("accountTab.sourceStatus")}</h4>
          <span
            className={`usage-sync-outcome is-${status?.overallOutcome ?? "idle"}`}
            title={t("accountTab.resultOfTheMostRecent")}
          >
            {status ? outcomeLabel : t("accountTab.checking")}
          </span>
        </div>
        <p className="text-muted text-sm">
          {t("accountTab.everyLocalToolBasebuildCan")}
        </p>
        {!status ? (
          <SkeletonRows rows={5} label={t("accountTab.loadingSourceStatus")} />
        ) : status.sources.length > 0 ? (
          <div className="usage-source-list">
            {[...status.sources]
              .sort((a, b) =>
                a.available !== b.available
                  ? Number(b.available) - Number(a.available)
                  : SOURCE_LABELS()[a.source].localeCompare(SOURCE_LABELS()[b.source]),
              )
              .map((source) => {
                const state = sourceState(source);
                return (
                  <div
                    className={`usage-source-row ${source.available ? "" : "is-unavailable"}`}
                    key={source.source}
                    title={t("accountTab.lastAcceptedUpload", { value: SOURCE_LABELS()[source.source], value2: SOURCE_HINTS()[source.source], lastSuccessAt: formatSyncTime(source.lastSuccessAt) })}
                  >
                    <div className="usage-source-name">
                      {state.className === "is-ok" ? <CheckCircle2 size={14} /> : null}
                      {state.className === "is-warning" ? <Clock3 size={14} /> : null}
                      {state.className === "is-error" ? <AlertCircle size={14} /> : null}
                      {state.className === "is-muted" ? <ShieldCheck size={14} /> : null}
                      <strong className="text-sm">{SOURCE_LABELS()[source.source]}</strong>
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
          <p className="text-muted text-sm">{t("accountTab.sourceStatusWillAppearAfter")}</p>
        )}
      </section>

      {status?.lastError ? (
        <p className="text-danger text-sm" title={status.lastError}>
          {t("accountTab.lastCoordinatorError", { lastError: status.lastError })}</p>
      ) : null}
      {lastSyncResult ? (
        <p className={`text-sm ${lastSyncResult.ok ? "text-muted" : "text-danger"}`} title={lastSyncResult.message}>
          {lastSyncResult.ok ? t("accountTab.success") : t("accountTab.failed")}
          {lastSyncResult.message}
        </p>
      ) : null}
      {error ? <p className="text-danger text-sm">{error}</p> : null}

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
      <h4>{t("accountTab.providerPlans")}</h4>
      <p className="text-muted text-sm">
        {t("accountTab.detectedNativelyFromYourProvider")}
      </p>
      {!gatesPass ? (
        <p className="text-muted text-sm">
          {t("accountTab.turnOnShareAnonymousAggregate")}
        </p>
      ) : null}
      {loading ? <p className="text-muted text-sm">{t("accountTab.detecting")}</p> : null}
      {detected.map((d) => {
        const options = catalog.get(d.provider) ?? [];
        return (
          <div key={d.provider} className="stack gap-xs">
            <div className="usage-plan-row row gap-sm flex-wrap" title={t("accountTab.text4", { provider: d.provider, source: d.source })}>
              <span className="text-sm usage-plan-provider">{d.provider}</span>
              {d.needsDeclaration ? (
                <select
                  className="input input-sm"
                  value={selections.get(d.provider) ?? ""}
                  disabled={saving || options.length === 0}
                  onChange={(e) => pickPlan(d.provider, e.target.value)}
                  title={t("accountTab.declareYourPlan", { provider: d.provider })}
                >
                  <option value="">
                    {options.length === 0 ? t("accountTab.noCatalogPlans") : t("accountTab.selectYourPlan")}
                  </option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <span className="text-sm" title={t("accountTab.detectedVia", { source: d.source })}>
                  ✓ {d.detectedPlanType ?? t("accountTab.detected")}
                  <span className="text-muted"> · {d.source === "native" ? t("accountTab.nativeCredential") : d.source}</span>
                </span>
              )}
              {d.confidence === "inferred" ? (
                <span className="text-muted text-sm" title={t("accountTab.predictedFromUsageVolumeNot")}>
                  {t("accountTab.inferred")}
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
          title={t("accountTab.saveDeclaredPlansToBasebuild")}
        >
          {saving ? t("accountTab.saving") : t((selections.size === 1 ? "accountTab.savePlan.none" : "accountTab.savePlan.s"), { size: selections.size })}
        </button>
      ) : null}
      {message ? <p className="text-muted text-sm">✓ {message}</p> : null}
      {error ? <p className="text-danger text-sm">{error}</p> : null}
    </div>
  );
}
