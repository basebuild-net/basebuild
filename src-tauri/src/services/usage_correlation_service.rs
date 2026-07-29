//! Solve how fast a plan window actually drains.
//!
//! Token counters answer "how much did I send". Quota snapshots answer "how
//! much of my plan is gone". Neither alone tells you what a request costs
//! against a subscription, because providers do not publish the conversion.
//! This service pairs the two: take two readings of the same quota window,
//! count the traffic that happened between them, and the ratio is an observed
//! drain rate. One pair is noise. Enough pairs is a usable estimate.
//!
//! Deliberately local. The wire rows are deleted once the server accepts them,
//! so this reads the two stores that persist — retained quota samples and OMP's
//! per-request `stats.db` — and never needs the network. That also makes it the
//! check on any server-side answer rather than a duplicate of it.

use std::collections::BTreeMap;
use std::path::PathBuf;

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::services::storage_service::StorageService;

/// A quota window must move at least this much before a pair is worth solving.
/// Below it, provider-side rounding dominates the signal.
const MIN_USED_DELTA: f64 = 0.0005;
/// Ignore pairs further apart than this: too much unobserved drift.
const MAX_PAIR_GAP_MS: i64 = 3 * 3_600_000;
/// A pair with no measured traffic cannot explain a drain.
const MIN_PAIR_TOKENS: i64 = 1;
/// How far two `resetsAt` values may differ and still name the same window.
///
/// Providers recompute the reset instant per response, so it jitters by
/// milliseconds between reads — observed live as 1785310200000 then
/// 1785310200199. Exact equality would reject almost every real pair. Genuinely
/// different windows are a whole window duration apart (hours), so a minute of
/// slack separates jitter from a rollover without ambiguity.
const RESET_IDENTITY_TOLERANCE_MS: i64 = 60_000;

/// Whether two readings describe the same quota window.
fn same_window(earlier: Option<i64>, later: Option<i64>) -> bool {
    match (earlier, later) {
        (Some(earlier), Some(later)) => {
            (earlier - later).abs() <= RESET_IDENTITY_TOLERANCE_MS
        }
        // No reset identity on either side: fall back to treating them as one
        // window. The alternative is discarding every pair from a provider that
        // does not publish a reset instant.
        (None, None) => true,
        // One side knows its window and the other does not: not comparable.
        _ => false,
    }
}

/// One solved interval between two readings of the same quota window.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrainInterval {
    pub started_at: i64,
    pub ended_at: i64,
    /// How much of the window was consumed across the interval, 0.0..=1.0.
    pub used_delta: f64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub requests: i64,
    /// Models that served traffic in the interval. A single entry means the
    /// drain is attributable; several means the rate is a blend.
    pub models: Vec<String>,
}

impl DrainInterval {
    pub fn total_tokens(&self) -> i64 {
        self.input_tokens
            .saturating_add(self.output_tokens)
            .saturating_add(self.cache_read_tokens)
            .saturating_add(self.cache_write_tokens)
    }
}

/// An observed drain rate for one quota window.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrainEstimate {
    pub provider: String,
    pub limit_id: String,
    /// Present when the provider scopes the window to one model.
    pub model_id: Option<String>,
    pub plan_type: Option<String>,
    pub window_label: Option<String>,
    /// Intervals that survived filtering and back this estimate.
    pub intervals: usize,
    pub requests: i64,
    pub total_tokens: i64,
    /// Window fraction consumed per 1000 tokens of observed traffic.
    pub fraction_per_1k_tokens: f64,
    pub fraction_per_request: f64,
    /// Spread of the per-interval rates, as a fraction of the mean. Low means
    /// the relationship is stable; high means the window is being shared or the
    /// provider meters something this does not measure.
    ///
    /// `None` below two intervals — there is no spread to speak of yet. It is
    /// an `Option` rather than an infinity because a non-finite float is not
    /// representable in JSON and serializes to `null` regardless; naming the
    /// absence keeps the contract honest.
    pub relative_spread: Option<f64>,
    /// `high` | `medium` | `low` — how much to trust the numbers above.
    pub confidence: String,
    /// Models seen across all intervals, most traffic first.
    pub models: Vec<String>,
    /// Latest reading of the window, for projection.
    pub observed_at: i64,
    pub remaining_fraction: f64,
    pub resets_at: Option<i64>,
    /// When the window would empty at the recent observed pace, if it is
    /// draining at all.
    pub projected_exhaustion_at: Option<i64>,
}

/// A quota reading, as retained locally.
struct Sample {
    observed_at: i64,
    used_fraction: f64,
    remaining_fraction: f64,
    resets_at: Option<i64>,
    model_id: Option<String>,
    plan_type: Option<String>,
    window_label: Option<String>,
    /// Traffic-store horizon when this reading was taken.
    ingested_through: Option<i64>,
}

/// Traffic totals over one time range.
#[derive(Default)]
struct Traffic {
    input: i64,
    output: i64,
    cache_read: i64,
    cache_write: i64,
    requests: i64,
    models: BTreeMap<String, i64>,
}

pub struct UsageCorrelationService;

impl UsageCorrelationService {
    /// Solve a drain rate for every quota window with enough retained readings.
    pub fn estimate_drain_rates() -> Result<Vec<DrainEstimate>, String> {
        let windows = load_samples()?;
        let stats_db = omp_stats_db_path().filter(|path| path.exists());
        let mut estimates = Vec::new();
        for ((provider, limit_id), samples) in windows {
            if samples.len() < 2 {
                continue;
            }
            let intervals = solve_intervals(&provider, &samples, stats_db.as_deref())?;
            if intervals.is_empty() {
                continue;
            }
            if let Some(estimate) = summarize(&provider, &limit_id, &samples, &intervals) {
                estimates.push(estimate);
            }
        }
        // Most-drained window first: that is the one about to bite.
        estimates.sort_by(|left, right| {
            left.remaining_fraction
                .partial_cmp(&right.remaining_fraction)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(estimates)
    }
}

/// Retained readings grouped by window, oldest first.
fn load_samples() -> Result<BTreeMap<(String, String), Vec<Sample>>, String> {
    let conn = StorageService::connect()?;
    let mut statement = conn
        .prepare(
            "SELECT provider, limit_id, observed_at, used_fraction, remaining_fraction,
                    resets_at, model_id, plan_type, window_label, ingested_through
             FROM usage_quota_samples
             ORDER BY provider ASC, limit_id ASC, observed_at ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                Sample {
                    observed_at: row.get(2)?,
                    used_fraction: row.get(3)?,
                    remaining_fraction: row.get(4)?,
                    resets_at: row.get(5)?,
                    model_id: row.get(6)?,
                    plan_type: row.get(7)?,
                    window_label: row.get(8)?,
                    ingested_through: row.get(9)?,
                },
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut grouped: BTreeMap<(String, String), Vec<Sample>> = BTreeMap::new();
    for row in rows {
        let (provider, limit_id, sample) = row.map_err(|error| error.to_string())?;
        grouped.entry((provider, limit_id)).or_default().push(sample);
    }
    Ok(grouped)
}

/// Pair consecutive readings of the same window and attach the traffic between.
///
/// A pair is dropped when the window reset between readings, when the bar moved
/// backwards or barely moved, when the readings are too far apart to trust, or
/// when no traffic was measured — each of those would put a meaningless point
/// into the fit.
fn solve_intervals(
    provider: &str,
    samples: &[Sample],
    stats_db: Option<&std::path::Path>,
) -> Result<Vec<DrainInterval>, String> {
    let mut intervals = Vec::new();
    let mut deferred = 0usize;
    for pair in samples.windows(2) {
        let (earlier, later) = (&pair[0], &pair[1]);
        if !same_window(earlier.resets_at, later.resets_at) {
            continue;
        }
        let used_delta = later.used_fraction - earlier.used_fraction;
        if used_delta < MIN_USED_DELTA {
            continue;
        }
        if later.observed_at - earlier.observed_at > MAX_PAIR_GAP_MS {
            continue;
        }
        // The traffic store had not caught up to this reading when it was taken,
        // so its window contains requests that were not on disk yet. Defer the
        // pair rather than scoring it as a drain with no cause: the readings are
        // retained, so it solves on a later pass once ingestion lands.
        if later
            .ingested_through
            .is_some_and(|horizon| horizon < later.observed_at)
        {
            deferred += 1;
            continue;
        }
        let traffic = match stats_db {
            Some(path) => traffic_between(
                path,
                provider,
                later.model_id.as_deref(),
                earlier.observed_at,
                later.observed_at,
            )?,
            None => Traffic::default(),
        };
        if traffic.requests < 1 {
            continue;
        }
        let mut models: Vec<(String, i64)> = traffic.models.into_iter().collect();
        models.sort_by(|left, right| right.1.cmp(&left.1));
        let interval = DrainInterval {
            started_at: earlier.observed_at,
            ended_at: later.observed_at,
            used_delta,
            input_tokens: traffic.input,
            output_tokens: traffic.output,
            cache_read_tokens: traffic.cache_read,
            cache_write_tokens: traffic.cache_write,
            requests: traffic.requests,
            models: models.into_iter().map(|(model, _)| model).collect(),
        };
        if interval.total_tokens() < MIN_PAIR_TOKENS {
            continue;
        }
        intervals.push(interval);
    }
    if deferred > 0 {
        eprintln!(
            "[USAGE] correlation: {deferred} pair(s) awaiting traffic ingestion for {provider}"
        );
    }
    Ok(intervals)
}

/// Open OMP's statistics database read-only: OMP owns it and may be writing.
fn open_stats_db(path: &std::path::Path) -> Result<rusqlite::Connection, String> {
    let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
        | rusqlite::OpenFlags::SQLITE_OPEN_URI
        | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX;
    rusqlite::Connection::open_with_flags(format!("file:{}", path.to_string_lossy()), flags)
        .map_err(|error| format!("could not open OMP stats.db: {error}"))
}

/// Sum OMP's per-request rows over `(after, until]`.
///
/// Read-only: OMP owns this database and may be writing to it.
fn traffic_between(
    path: &std::path::Path,
    provider: &str,
    model_id: Option<&str>,
    after: i64,
    until: i64,
) -> Result<Traffic, String> {
    let conn = open_stats_db(path)?;
    let mut traffic = Traffic::default();
    let mut statement = conn
        .prepare(
            "SELECT model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
             FROM messages
             WHERE provider = ?1 AND timestamp > ?2 AND timestamp <= ?3",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![provider, after, until], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<i64>>(4)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        let (model, input, output, cache_read, cache_write) =
            row.map_err(|error| error.to_string())?;
        let model = model.unwrap_or_else(|| "unknown".to_string());
        // A per-model window is only drained by that model; an account-wide one
        // is drained by everything.
        if let Some(wanted) = model_id {
            if model != wanted {
                continue;
            }
        }
        traffic.input = traffic.input.saturating_add(input.unwrap_or_default().max(0));
        traffic.output = traffic
            .output
            .saturating_add(output.unwrap_or_default().max(0));
        traffic.cache_read = traffic
            .cache_read
            .saturating_add(cache_read.unwrap_or_default().max(0));
        traffic.cache_write = traffic
            .cache_write
            .saturating_add(cache_write.unwrap_or_default().max(0));
        traffic.requests = traffic.requests.saturating_add(1);
        *traffic.models.entry(model).or_insert(0) += 1;
    }
    Ok(traffic)
}

/// Reduce solved intervals to one rate, with an honest confidence label.
fn summarize(
    provider: &str,
    limit_id: &str,
    samples: &[Sample],
    intervals: &[DrainInterval],
) -> Option<DrainEstimate> {
    let latest = samples.last()?;
    let total_tokens: i64 = intervals.iter().map(DrainInterval::total_tokens).sum();
    let requests: i64 = intervals.iter().map(|interval| interval.requests).sum();
    let used_total: f64 = intervals.iter().map(|interval| interval.used_delta).sum();
    if total_tokens <= 0 || requests <= 0 || used_total <= 0.0 {
        return None;
    }
    let fraction_per_1k_tokens = used_total / (total_tokens as f64 / 1000.0);
    let fraction_per_request = used_total / requests as f64;

    // Spread of the per-interval rates. A stable relationship gives a tight
    // cluster; a shared or mismetered window gives a wide one.
    let rates: Vec<f64> = intervals
        .iter()
        .filter(|interval| interval.total_tokens() > 0)
        .map(|interval| interval.used_delta / (interval.total_tokens() as f64 / 1000.0))
        .collect();
    let mean = rates.iter().sum::<f64>() / rates.len() as f64;
    let relative_spread = if rates.len() > 1 && mean > 0.0 {
        let variance = rates
            .iter()
            .map(|rate| (rate - mean).powi(2))
            .sum::<f64>()
            / (rates.len() - 1) as f64;
        Some(variance.sqrt() / mean)
    } else {
        None
    };
    // A window is shared if more than one model drained it across the whole
    // sample, not merely within one interval. Checking per-interval missed the
    // common case: a window serving one model at a time but several over a day
    // still yields a blended rate, and was reporting itself as trustworthy.
    let distinct_models = intervals
        .iter()
        .flat_map(|interval| interval.models.iter())
        .collect::<std::collections::BTreeSet<_>>();
    let mixed = distinct_models.len() > 1;
    // An unknown spread is never treated as a tight one: no spread, no
    // confidence.
    let tight = |ceiling: f64| relative_spread.is_some_and(|spread| spread < ceiling);
    let confidence = if intervals.len() >= 12 && tight(0.35) && !mixed {
        "high"
    } else if intervals.len() >= 5 && tight(0.75) {
        "medium"
    } else {
        "low"
    };

    // Project from the most recent intervals only — an old burst should not
    // dominate the estimate of what is happening now.
    let recent: Vec<&DrainInterval> = intervals.iter().rev().take(5).collect();
    let recent_span_ms: i64 = recent
        .iter()
        .map(|interval| (interval.ended_at - interval.started_at).max(1))
        .sum();
    let recent_used: f64 = recent.iter().map(|interval| interval.used_delta).sum();
    let projected_exhaustion_at = if recent_used > 0.0 && recent_span_ms > 0 {
        let per_ms = recent_used / recent_span_ms as f64;
        if per_ms > 0.0 {
            let ms_left = (latest.remaining_fraction / per_ms) as i64;
            Some(latest.observed_at.saturating_add(ms_left.max(0)))
        } else {
            None
        }
    } else {
        None
    };

    let mut model_totals: BTreeMap<&str, usize> = BTreeMap::new();
    for interval in intervals {
        for model in &interval.models {
            *model_totals.entry(model.as_str()).or_insert(0) += 1;
        }
    }
    let mut models: Vec<(&str, usize)> = model_totals.into_iter().collect();
    models.sort_by(|left, right| right.1.cmp(&left.1));

    Some(DrainEstimate {
        provider: provider.to_string(),
        limit_id: limit_id.to_string(),
        model_id: latest.model_id.clone(),
        plan_type: latest.plan_type.clone(),
        window_label: latest.window_label.clone(),
        intervals: intervals.len(),
        requests,
        total_tokens,
        fraction_per_1k_tokens,
        fraction_per_request,
        relative_spread,
        confidence: confidence.to_string(),
        models: models
            .into_iter()
            .map(|(model, _)| model.to_string())
            .collect(),
        observed_at: latest.observed_at,
        remaining_fraction: latest.remaining_fraction,
        resets_at: latest.resets_at,
        projected_exhaustion_at,
    })
}

fn omp_stats_db_path() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(|home| PathBuf::from(home).join(".omp").join("stats.db"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_stats_db(path: &std::path::Path, rows: &[(&str, &str, i64, i64)]) {
        let conn = rusqlite::Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, model TEXT,
                timestamp INTEGER, input_tokens INTEGER, output_tokens INTEGER,
                cache_read_tokens INTEGER, cache_write_tokens INTEGER)",
        )
        .unwrap();
        for (provider, model, timestamp, tokens) in rows {
            conn.execute(
                "INSERT INTO messages
                    (provider, model, timestamp, input_tokens, output_tokens,
                     cache_read_tokens, cache_write_tokens)
                 VALUES (?1, ?2, ?3, ?4, 0, 0, 0)",
                params![provider, model, timestamp, tokens],
            )
            .unwrap();
        }
    }

    /// A reading whose traffic had already landed when it was taken.
    fn sample(observed_at: i64, used: f64, resets_at: Option<i64>, model: Option<&str>) -> Sample {
        Sample {
            observed_at,
            used_fraction: used,
            remaining_fraction: 1.0 - used,
            resets_at,
            model_id: model.map(str::to_string),
            plan_type: None,
            window_label: None,
            ingested_through: Some(observed_at),
        }
    }

    /// A reading taken while the traffic store was still behind.
    fn lagging_sample(observed_at: i64, used: f64, resets_at: Option<i64>, horizon: i64) -> Sample {
        Sample {
            ingested_through: Some(horizon),
            ..sample(observed_at, used, resets_at, None)
        }
    }

    /// End-to-end against the real machine: seed two readings that bracket a
    /// known burst in this workstation's own `~/.omp/stats.db`, then let the
    /// shipping solver find and price it. Ignored by default because it depends
    /// on local history.
    ///
    /// Run with the bracket from a real burst:
    ///   BB_DRAIN_FROM=<ms> BB_DRAIN_TO=<ms> BB_DRAIN_PROVIDER=anthropic \
    ///   cargo test --lib live_drain_rate -- --ignored --nocapture
    #[test]
    #[ignore = "reads this machine's real OMP history"]
    fn live_drain_rate_is_solved_from_real_traffic() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        let from: i64 = std::env::var("BB_DRAIN_FROM").unwrap().parse().unwrap();
        let to: i64 = std::env::var("BB_DRAIN_TO").unwrap().parse().unwrap();
        let provider = std::env::var("BB_DRAIN_PROVIDER").unwrap();
        let model = std::env::var("BB_DRAIN_MODEL").ok();

        // Real observed fractions when supplied, so the rate below is measured
        // rather than assumed. Defaults keep the harness usable without them.
        let used_from: f64 = std::env::var("BB_DRAIN_USED_FROM")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0.20);
        let used_to: f64 = std::env::var("BB_DRAIN_USED_TO")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0.30);
        let observed_delta = used_to - used_from;
        let conn = StorageService::connect().unwrap();
        for (observed_at, used) in [(from, used_from), (to, used_to)] {
            conn.execute(
                "INSERT INTO usage_quota_samples
                    (provider, limit_id, observed_at, model_id, window_label, plan_type,
                     used_fraction, remaining_fraction, resets_at, window_duration_ms)
                 VALUES (?1, 'live:window', ?2, ?3, '5h', 'Max', ?4, ?5, 999, 18000000)",
                params![provider, observed_at, model, used, 1.0 - used],
            )
            .unwrap();
        }

        let estimates = UsageCorrelationService::estimate_drain_rates().unwrap();
        let estimate = estimates
            .iter()
            .find(|estimate| estimate.provider == provider)
            .expect("the seeded window must be solved");
        println!("--- live drain estimate ---");
        println!("{}", serde_json::to_string_pretty(estimate).unwrap());
        println!(
            "observed: {} requests, {} tokens over {:.1} min",
            estimate.requests,
            estimate.total_tokens,
            (to - from) as f64 / 60_000.0
        );
        println!(
            "rate: {:.3e} of window per 1k tokens | {:.3e} per request",
            estimate.fraction_per_1k_tokens, estimate.fraction_per_request
        );

        assert_eq!(estimate.intervals, 1);
        assert!(
            estimate.requests > 0 && estimate.total_tokens > 0,
            "real traffic must be found in the bracket"
        );
        // The measured delta over the measured traffic.
        let expected = observed_delta / (estimate.total_tokens as f64 / 1000.0);
        assert!(
            (estimate.fraction_per_1k_tokens - expected).abs() < 1e-12,
            "rate must equal used delta over measured tokens"
        );
        assert!(
            (estimate.fraction_per_request - observed_delta / estimate.requests as f64).abs()
                < 1e-12
        );
        // Extrapolate the measured rate to the whole window, which is the number
        // a user actually cares about.
        if estimate.fraction_per_1k_tokens > 0.0 {
            let tokens_per_window = 1000.0 / estimate.fraction_per_1k_tokens;
            let requests_per_window = 1.0 / estimate.fraction_per_request;
            println!(
                "extrapolated: ~{:.0} tokens or ~{:.0} requests would consume the whole window",
                tokens_per_window, requests_per_window
            );
        }
    }


    /// The core relationship: 10k tokens moved the bar 1%, so the rate is
    /// 0.001 per 1k tokens. If this drifts, every projection built on it is
    /// wrong in the same direction.
    #[test]
    fn drain_rate_is_solved_from_traffic_between_two_readings() {
        let dir = tempfile::TempDir::new().unwrap();
        let db = dir.path().join("stats.db");
        seed_stats_db(
            &db,
            &[
                ("anthropic", "claude-opus-5", 1_000, 5_000),
                ("anthropic", "claude-opus-5", 2_000, 5_000),
            ],
        );
        let samples = vec![
            sample(0, 0.10, Some(99), None),
            sample(3_000, 0.11, Some(99), None),
        ];
        let intervals = solve_intervals("anthropic", &samples, Some(&db)).unwrap();
        assert_eq!(intervals.len(), 1);
        assert_eq!(intervals[0].total_tokens(), 10_000);
        assert_eq!(intervals[0].requests, 2);

        let estimate = summarize("anthropic", "limit", &samples, &intervals).unwrap();
        assert!(
            (estimate.fraction_per_1k_tokens - 0.001).abs() < 1e-9,
            "10k tokens per 1% means 0.001/1k, got {}",
            estimate.fraction_per_1k_tokens
        );
        assert!((estimate.fraction_per_request - 0.005).abs() < 1e-9);
        // One interval proves nothing about stability.
        assert_eq!(estimate.confidence, "low");
        assert_eq!(estimate.remaining_fraction, 0.89);
        // A single interval has no spread. It must be absent rather than an
        // infinity, which JSON cannot represent and which serializes to a
        // `null` indistinguishable from a real value.
        assert_eq!(estimate.relative_spread, None);
        let encoded = serde_json::to_string(&estimate).unwrap();
        assert!(
            encoded.contains("\"relativeSpread\":null"),
            "spread must round-trip as an explicit null: {encoded}"
        );
        for value in [
            estimate.fraction_per_1k_tokens,
            estimate.fraction_per_request,
        ] {
            assert!(value.is_finite(), "rates must be JSON-representable");
        }
    }

    /// A reset between readings is not a drain of zero — it is a different
    /// window, and pairing across it would invent a negative rate.
    #[test]
    fn pairs_spanning_a_window_reset_are_discarded() {
        let dir = tempfile::TempDir::new().unwrap();
        let db = dir.path().join("stats.db");
        seed_stats_db(&db, &[("anthropic", "claude-opus-5", 1_500, 9_000)]);
        let samples = vec![
            sample(0, 0.90, Some(1), None),
            sample(3_000, 0.05, Some(2), None),
        ];
        assert!(
            solve_intervals("anthropic", &samples, Some(&db))
                .unwrap()
                .is_empty(),
            "a reset boundary carries no drain signal"
        );
    }

    /// A per-model window is only drained by its own model. Counting a
    /// concurrent model's traffic against it would understate the true rate.
    #[test]
    fn per_model_windows_only_count_their_own_traffic() {
        let dir = tempfile::TempDir::new().unwrap();
        let db = dir.path().join("stats.db");
        seed_stats_db(
            &db,
            &[
                ("anthropic", "claude-opus-5", 1_000, 4_000),
                ("anthropic", "claude-haiku-4-5", 1_500, 50_000),
            ],
        );
        let samples = vec![
            sample(0, 0.20, Some(7), Some("claude-opus-5")),
            sample(2_000, 0.22, Some(7), Some("claude-opus-5")),
        ];
        let intervals = solve_intervals("anthropic", &samples, Some(&db)).unwrap();
        assert_eq!(intervals.len(), 1);
        assert_eq!(
            intervals[0].total_tokens(),
            4_000,
            "the other model's traffic must not be attributed to this window"
        );
        assert_eq!(intervals[0].models, vec!["claude-opus-5".to_string()]);
    }

    /// Traffic with no bar movement, and bar movement with no traffic, are both
    /// unusable — and a window shared by several models can only ever be a
    /// blended rate, which must not be reported as trustworthy.
    #[test]
    fn unusable_pairs_are_dropped_and_mixed_windows_stay_low_confidence() {
        let dir = tempfile::TempDir::new().unwrap();
        let db = dir.path().join("stats.db");
        seed_stats_db(
            &db,
            &[
                ("anthropic", "claude-opus-5", 1_000, 5_000),
                ("anthropic", "glm-5-2", 1_200, 5_000),
            ],
        );
        // Bar did not move.
        let flat = vec![sample(0, 0.30, Some(3), None), sample(2_000, 0.30, Some(3), None)];
        assert!(solve_intervals("anthropic", &flat, Some(&db))
            .unwrap()
            .is_empty());

        // Bar moved but no traffic in range.
        let no_traffic = vec![
            sample(500_000, 0.30, Some(3), None),
            sample(502_000, 0.40, Some(3), None),
        ];
        assert!(solve_intervals("anthropic", &no_traffic, Some(&db))
            .unwrap()
            .is_empty());

        // Two models drained one window: blended, so never "high".
        let mixed = vec![sample(0, 0.30, Some(3), None), sample(2_000, 0.34, Some(3), None)];
        let intervals = solve_intervals("anthropic", &mixed, Some(&db)).unwrap();
        assert_eq!(intervals[0].models.len(), 2);
        let estimate = summarize("anthropic", "limit", &mixed, &intervals).unwrap();
        assert_eq!(estimate.confidence, "low");

        // The case real data exposed: each interval saw a single model, but a
        // different one, so a per-interval check called the window unshared and
        // reported "high". Twelve tight intervals is otherwise enough for high
        // confidence, which is exactly what makes this dangerous.
        let mut per_interval_single = Vec::new();
        for step in 0..14i64 {
            per_interval_single.push(sample(step * 10_000, 0.01 * step as f64, Some(9), None));
        }
        let staggered = dir.path().join("staggered.db");
        let mut rows = Vec::new();
        for step in 0..14i64 {
            // Alternate which model is active in each interval.
            let model = if step % 2 == 0 { "model-a" } else { "model-b" };
            rows.push(("anthropic", model, step * 10_000 + 5_000, 10_000i64));
        }
        seed_stats_db(&staggered, &rows);
        let intervals = solve_intervals("anthropic", &per_interval_single, Some(&staggered)).unwrap();
        assert!(intervals.len() >= 12, "enough intervals to reach high");
        assert!(
            intervals.iter().all(|interval| interval.models.len() == 1),
            "each interval individually saw exactly one model"
        );
        let estimate =
            summarize("anthropic", "limit", &per_interval_single, &intervals).unwrap();
        assert!(estimate.models.len() > 1, "the window is shared overall");
        assert_ne!(
            estimate.confidence, "high",
            "a window shared across intervals is still a blended rate"
        );
    }

    /// OMP ingests its session files lazily, so a fresh pair routinely lands
    /// before the traffic that explains it. Such a pair must be deferred, not
    /// counted as zero traffic — otherwise the most recent interval, the one a
    /// user is actually asking about, is silently thrown away every time.
    ///
    /// Found by running the solver against a real machine: the quota bar had
    /// moved 0.31 -> 0.37 while `stats.db` was still an hour behind.
    #[test]
    fn pairs_beyond_the_ingestion_horizon_are_deferred_not_discarded() {
        let dir = tempfile::TempDir::new().unwrap();
        let db = dir.path().join("stats.db");
        seed_stats_db(&db, &[("anthropic", "claude-opus-5", 3_000, 8_000)]);

        // The reading was taken while the store had only reached t=1000, so the
        // request at t=3000 was not on disk yet. Zero traffic here would be a
        // measurement artefact, not a fact about usage.
        let lagging = vec![
            sample(2_000, 0.31, Some(5), None),
            lagging_sample(9_000, 0.37, Some(5), 1_000),
        ];
        assert!(
            solve_intervals("anthropic", &lagging, Some(&db))
                .unwrap()
                .is_empty(),
            "a reading taken before its traffic landed must be deferred"
        );

        // The same readings, recorded once ingestion had caught up, solve — and
        // pick up the traffic that was always there. Deferral costs a pass, not
        // the data.
        let caught_up = vec![
            sample(2_000, 0.31, Some(5), None),
            lagging_sample(9_000, 0.37, Some(5), 9_000),
        ];
        let intervals = solve_intervals("anthropic", &caught_up, Some(&db)).unwrap();
        assert_eq!(intervals.len(), 1, "an ingested pair must solve");
        assert_eq!(intervals[0].total_tokens(), 8_000);
        assert!((intervals[0].used_delta - 0.06).abs() < 1e-9);

        // A reading with no recorded horizon predates this column; it must still
        // be usable rather than deferred forever.
        let unknown = vec![
            sample(2_000, 0.31, Some(5), None),
            Sample {
                ingested_through: None,
                ..sample(9_000, 0.37, Some(5), None)
            },
        ];
        assert_eq!(
            solve_intervals("anthropic", &unknown, Some(&db)).unwrap().len(),
            1,
            "an unknown horizon must not strand the pair"
        );
    }

    /// Providers recompute `resetsAt` per response, so it drifts by
    /// milliseconds between reads. Observed live: 1785310200000 then
    /// 1785310200199 — the same 5h window, two different numbers. Exact
    /// equality here rejected essentially every real pair.
    #[test]
    fn reset_identity_tolerates_jitter_but_not_a_rollover() {
        let dir = tempfile::TempDir::new().unwrap();
        let db = dir.path().join("stats.db");
        seed_stats_db(&db, &[("anthropic", "claude-opus-5", 1_500, 10_000)]);

        // Millisecond drift is the same window.
        let jittered = vec![
            sample(1_000, 0.31, Some(1_785_310_200_000), None),
            sample(2_000, 0.37, Some(1_785_310_200_199), None),
        ];
        assert_eq!(
            solve_intervals("anthropic", &jittered, Some(&db)).unwrap().len(),
            1,
            "millisecond jitter in resetsAt must not discard the pair"
        );

        // A real rollover is a whole window away and must still be rejected.
        let rolled = vec![
            sample(1_000, 0.90, Some(1_785_310_200_000), None),
            sample(2_000, 0.05, Some(1_785_328_200_000), None),
        ];
        assert!(
            solve_intervals("anthropic", &rolled, Some(&db))
                .unwrap()
                .is_empty(),
            "a window rollover carries no drain signal"
        );

        assert!(same_window(None, None), "providers without a reset instant");
        assert!(!same_window(Some(1), None), "half-known identity is not comparable");
    }

    /// The whole pipeline against this machine, with nothing fabricated: seed
    /// from OMP's own recorded quota history, then solve. This is the cold-start
    /// path a fresh install takes, so it is also the honest check on whether the
    /// estimate is worth showing on day one.
    #[test]
    #[ignore = "reads this machine's real OMP history"]
    fn live_backfilled_history_solves_real_drain_rates() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        crate::services::analytics_service::AnalyticsService::set_consent(
            &crate::models::permission::AnalyticsConsent {
                collection_enabled: true,
                upload_enabled: false,
                consent_version: Some("test".to_string()),
                consented_at: Some(1),
            },
        )
        .unwrap();

        let seeded =
            crate::services::usage_v2_collector_service::UsageV2CollectorService::backfill_history_for_test()
                .unwrap();
        println!("seeded {seeded} readings from OMP's recorded history");
        assert!(
            seeded > 0,
            "this machine has no recorded quota history to seed from"
        );

        let estimates = UsageCorrelationService::estimate_drain_rates().unwrap();
        println!("solved {} window(s)", estimates.len());
        for estimate in &estimates {
            println!(
                "{:22} {:28} remaining={:5.1}%  {:>5} intervals  {:>8} req  {:>13} tok  \
                 {:.3e}/1k  spread={}  {}",
                estimate.provider,
                estimate.model_id.as_deref().unwrap_or(
                    estimate.window_label.as_deref().unwrap_or(&estimate.limit_id)
                ),
                estimate.remaining_fraction * 100.0,
                estimate.intervals,
                estimate.requests,
                estimate.total_tokens,
                estimate.fraction_per_1k_tokens,
                estimate
                    .relative_spread
                    .map(|spread| format!("{spread:.2}"))
                    .unwrap_or_else(|| "—".to_string()),
                estimate.confidence,
            );
            // Every reported number must be finite and in range, or the UI will
            // render nonsense.
            assert!(estimate.fraction_per_1k_tokens.is_finite());
            assert!(estimate.fraction_per_request.is_finite());
            assert!((0.0..=1.0).contains(&estimate.remaining_fraction));
            assert!(estimate.intervals >= 1 && estimate.requests >= 1);
            assert!(
                estimate.models.len() <= 1 || estimate.confidence != "high",
                "a window shared by several models must never claim high confidence"
            );
        }
    }
}
