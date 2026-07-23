//! Strategy resolution and request-time candidate ordering.
//!
//! Owns the in-memory rotation state: the per-provider round-robin cursor and
//! the sticky-session assignment map. Both are process-local by design —
//! health persists in storage, rotation position does not need to survive
//! restarts.

use std::collections::HashMap;
use std::sync::LazyLock;

use parking_lot::Mutex;
use rusqlite::{params, OptionalExtension};

use crate::services::storage_service::StorageService;

use super::{
    health, now_seconds, omp_account_id, DbResult, ProviderAccountRecord, ProviderAccountService,
    SelectionStrategy, AUTH_OMP, HEALTH_AUTH_EXPIRED, HEALTH_ERROR, HEALTH_HEALTHY,
    HEALTH_RATE_LIMITED,
};

/// Round-robin cursor per provider (in-memory by design; health persists, the
/// rotation position does not need to survive restarts).
static RR_CURSORS: LazyLock<Mutex<HashMap<String, usize>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// Sticky-session assignment: session key → account id.
static STICKY_ACCOUNTS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

const STRATEGY_GLOBAL_KEY: &str = "provider_account_strategy";

/// Release every sticky-session pin pointing at `account_id` (the account was
/// removed or turned unhealthy; its sessions must re-select).
pub(super) fn release_sticky_for_account(account_id: &str) {
    STICKY_ACCOUNTS.lock().retain(|_, v| v != account_id);
}

impl ProviderAccountService {
    // ─── Strategy ───

    pub fn strategy_for(provider_id: &str) -> SelectionStrategy {
        let conn = match StorageService::connect() {
            Ok(c) => c,
            Err(_) => return SelectionStrategy::RoundRobin,
        };
        for key in [
            format!("{STRATEGY_GLOBAL_KEY}:{provider_id}"),
            STRATEGY_GLOBAL_KEY.to_string(),
        ] {
            let value: Option<String> = conn
                .query_row(
                    "SELECT value FROM app_defaults WHERE key = ?1",
                    params![key],
                    |row| row.get(0),
                )
                .optional()
                .ok()
                .flatten();
            if let Some(strategy) = value.as_deref().and_then(SelectionStrategy::parse) {
                return strategy;
            }
        }
        SelectionStrategy::RoundRobin
    }

    pub fn set_strategy(provider_id: Option<&str>, strategy: &str) -> DbResult<()> {
        let parsed = SelectionStrategy::parse(strategy)
            .ok_or_else(|| format!("Unknown strategy '{strategy}'."))?;
        let key = match provider_id {
            Some(id) => format!("{STRATEGY_GLOBAL_KEY}:{id}"),
            None => STRATEGY_GLOBAL_KEY.to_string(),
        };
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO app_defaults (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, parsed.as_str()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─── Selection & failover ───

    /// Ordered candidate list for a request: strategy-ordered healthy stored
    /// accounts (rate-limited past cooldown counts as healthy), then the OMP
    /// virtual account as explicit fallback, then `error` accounts as a last
    /// resort (a transient failure must not permanently strand an account).
    /// `auth_expired` and in-cooldown accounts are excluded — the former needs
    /// a re-login, the latter is skipped by spec.
    pub fn candidates(
        provider_id: &str,
        session_key: Option<&str>,
    ) -> DbResult<Vec<ProviderAccountRecord>> {
        let records = Self::list_records(Some(provider_id))?;
        let now = now_seconds();
        let mut healthy: Vec<ProviderAccountRecord> = Vec::new();
        let mut errored: Vec<ProviderAccountRecord> = Vec::new();
        for record in records {
            match record.health.as_str() {
                HEALTH_HEALTHY => healthy.push(record),
                HEALTH_RATE_LIMITED => {
                    if record.cooldown_until.is_none_or(|until| until <= now) {
                        healthy.push(record);
                    }
                }
                HEALTH_ERROR => errored.push(record),
                _ => {} // auth_expired: excluded until re-login or manual test
            }
        }

        // Strategy ordering over the healthy set.
        match Self::strategy_for(provider_id) {
            SelectionStrategy::RoundRobin => {
                if healthy.len() > 1 {
                    let mut cursors = RR_CURSORS.lock();
                    let cursor = cursors.entry(provider_id.to_string()).or_insert(0);
                    let start = *cursor % healthy.len();
                    *cursor = cursor.wrapping_add(1);
                    healthy.rotate_left(start);
                }
            }
            SelectionStrategy::StickySession => {
                if let Some(session) = session_key {
                    let mut sticky = STICKY_ACCOUNTS.lock();
                    let pinned = sticky.get(session).cloned();
                    match pinned.and_then(|id| healthy.iter().position(|r| r.id == id)) {
                        Some(index) => healthy.rotate_left(index),
                        None => {
                            // Assign: spread new sessions round-robin.
                            if healthy.len() > 1 {
                                let mut cursors = RR_CURSORS.lock();
                                let cursor = cursors.entry(provider_id.to_string()).or_insert(0);
                                let start = *cursor % healthy.len();
                                *cursor = cursor.wrapping_add(1);
                                healthy.rotate_left(start);
                            }
                            if let Some(first) = healthy.first() {
                                sticky.insert(session.to_string(), first.id.clone());
                            }
                        }
                    }
                }
            }
            SelectionStrategy::FillFirst => {} // created_at ASC is the stored order
        }

        let mut ordered = healthy;
        // OMP virtual account: explicit fallback after healthy native accounts.
        if let Some(omp) =
            crate::services::native_chat_service::NativeChatService::omp_credential_for(provider_id)
        {
            if !Self::is_provider_blocked(provider_id)? {
                let virtual_id = omp_account_id(provider_id);
                if health::omp_account_usable(&virtual_id, now) {
                    ordered.push(ProviderAccountRecord {
                        id: virtual_id,
                        provider_id: provider_id.to_string(),
                        label: omp.label,
                        auth_method: AUTH_OMP.to_string(),
                        api_key: omp.api_key,
                        base_url: omp.base_url,
                        identity_key: None,
                        health: HEALTH_HEALTHY.to_string(),
                        cooldown_until: None,
                        last_error: None,
                        last_used_at: None,
                        created_at: omp.updated_at,
                        updated_at: omp.updated_at,
                    });
                }
            }
        }
        ordered.extend(errored);
        Ok(ordered)
    }

    /// Human-readable exhaustion message naming per-account states and the
    /// soonest cooldown expiry (spec: "all accounts exhausted").
    pub fn exhaustion_message(provider_id: &str, provider_label: &str) -> String {
        let records = Self::list_records(Some(provider_id)).unwrap_or_default();
        if records.is_empty() {
            return format!("No {provider_label} account is available.");
        }
        let now = now_seconds();
        let mut parts: Vec<String> = Vec::new();
        let mut soonest: Option<i64> = None;
        for record in &records {
            let state = match record.health.as_str() {
                HEALTH_RATE_LIMITED => {
                    if let Some(until) = record.cooldown_until {
                        soonest = Some(soonest.map_or(until, |s: i64| s.min(until)));
                        format!("rate limited ({}s left)", (until - now).max(0))
                    } else {
                        "rate limited".to_string()
                    }
                }
                HEALTH_AUTH_EXPIRED => "login expired — log in again".to_string(),
                HEALTH_ERROR => record
                    .last_error
                    .clone()
                    .unwrap_or_else(|| "error".to_string()),
                other => other.to_string(),
            };
            parts.push(format!("{}: {state}", record.label));
        }
        let mut message = format!(
            "Every {provider_label} account is unavailable — {}.",
            parts.join("; ")
        );
        if let Some(until) = soonest {
            message.push_str(&format!(
                " The next account frees up in {}s.",
                (until - now).max(0)
            ));
        }
        message
    }
}

#[cfg(test)]
mod tests {
    use super::super::{AccountOutcome, HEALTH_AUTH_EXPIRED};
    use super::*;
    use crate::test_util::test::isolated_home;

    /// Seed `count` healthy API-key accounts on `provider_id` and return their
    /// ids in created order. Uses distinct keys so identities never dedupe.
    fn seed_accounts(provider_id: &str, count: usize) -> Vec<String> {
        let conn = StorageService::connect().expect("connect for seed");
        (0..count)
            .map(|index| {
                let (record, _) = ProviderAccountService::upsert_account(
                    provider_id,
                    &format!("acct-{index}"),
                    "api",
                    &format!("sk-{provider_id}-{index}"),
                    None,
                    &format!("sk256:{provider_id}:{index}"),
                )
                .expect("seed account");
                // now_seconds() is second-resolution, so same-second seeds
                // would otherwise tie on created_at and fall back to SQLite's
                // unspecified tie order. Backdate deterministically instead.
                conn.execute(
                    "UPDATE native_provider_accounts SET created_at = ?1 WHERE id = ?2",
                    params![1_000_000 + index as i64, &record.id],
                )
                .expect("backdate created_at");
                record.id
            })
            .collect()
    }

    fn first_candidate(provider_id: &str, session: Option<&str>) -> String {
        ProviderAccountService::candidates(provider_id, session).expect("candidates")[0]
            .id
            .clone()
    }

    /// Round-robin must rotate the start position between consecutive calls —
    /// a stuck `RR_CURSORS` cursor would pin all traffic to one account. The
    /// cursor is process-global, so the test asserts *rotation between calls*
    /// rather than an absolute start index.
    #[test]
    fn round_robin_rotates_start_between_calls() {
        let (_dir, _guard) = isolated_home();
        let provider = "test-rr-provider";
        let ids = seed_accounts(provider, 3);
        ProviderAccountService::set_strategy(Some(provider), "round_robin").expect("set strategy");

        let first_a = first_candidate(provider, None);
        let first_b = first_candidate(provider, None);
        let first_c = first_candidate(provider, None);
        assert_ne!(first_a, first_b, "consecutive calls must rotate the head");
        assert_ne!(first_b, first_c, "rotation must keep advancing");

        // Every call returns the full healthy set, just reordered.
        let all = ProviderAccountService::candidates(provider, None).expect("candidates");
        assert_eq!(all.len(), 3);
        for id in &ids {
            assert!(
                all.iter().any(|r| &r.id == id),
                "candidate set must be stable"
            );
        }
    }

    /// Sticky sessions pin one account per session key across calls (even as
    /// the round-robin cursor advances) and release the pin when the account
    /// turns unhealthy.
    #[test]
    fn sticky_session_pins_and_releases_on_unhealthy() {
        let (_dir, _guard) = isolated_home();
        let provider = "test-sticky-provider";
        seed_accounts(provider, 2);
        ProviderAccountService::set_strategy(Some(provider), "sticky_session")
            .expect("set strategy");

        let session = "sticky-test-session-1";
        let pinned = first_candidate(provider, Some(session));
        for _ in 0..3 {
            assert_eq!(
                first_candidate(provider, Some(session)),
                pinned,
                "session must stay pinned to its account"
            );
        }

        // The pinned account fails hard → the pin is released and the session
        // re-selects the other (still healthy) account.
        ProviderAccountService::record_outcome(
            &pinned,
            AccountOutcome::TransportError("boom".to_string()),
        );
        let reselected = first_candidate(provider, Some(session));
        assert_ne!(reselected, pinned, "unhealthy account must release its pin");
    }

    /// Fill-first keeps stored order (created_at ASC) call after call.
    #[test]
    fn fill_first_is_stable_in_created_order() {
        let (_dir, _guard) = isolated_home();
        let provider = "test-fill-provider";
        let ids = seed_accounts(provider, 3);
        ProviderAccountService::set_strategy(Some(provider), "fill_first").expect("set strategy");

        for _ in 0..3 {
            let ordered = ProviderAccountService::candidates(provider, None).expect("candidates");
            let got: Vec<&String> = ordered.iter().map(|r| &r.id).collect();
            assert_eq!(
                got,
                ids.iter().collect::<Vec<_>>(),
                "fill_first must not rotate"
            );
        }
    }

    /// The health buckets drive inclusion: in-cooldown rate-limited accounts
    /// are excluded, expired cooldowns count as healthy again, auth_expired
    /// is excluded outright, and errored accounts come last.
    #[test]
    fn candidates_applies_health_buckets() {
        let (_dir, _guard) = isolated_home();
        let provider = "test-health-provider";
        let ids = seed_accounts(provider, 4);
        ProviderAccountService::set_strategy(Some(provider), "fill_first").expect("set strategy");

        // ids[0]: rate limited with a future cooldown → excluded.
        ProviderAccountService::record_outcome(&ids[0], AccountOutcome::RateLimited(Some(3600)));
        // ids[1]: auth expired → excluded until re-login.
        ProviderAccountService::record_outcome(
            &ids[1],
            AccountOutcome::AuthExpired("Authentication failed (401) for 'x'.".to_string()),
        );
        // ids[2]: transport error → last resort.
        ProviderAccountService::record_outcome(
            &ids[2],
            AccountOutcome::TransportError("socket reset".to_string()),
        );

        let ordered = ProviderAccountService::candidates(provider, None).expect("candidates");
        let got: Vec<&str> = ordered.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(
            got,
            vec![ids[3].as_str(), ids[2].as_str()],
            "healthy first, errored last, cooldown + auth_expired excluded"
        );

        // Expire ids[0]'s cooldown directly (record_outcome clamps retry_after
        // to >= 1s, so simulate the passage of time in the row itself).
        {
            let conn = StorageService::connect().expect("connect");
            conn.execute(
                "UPDATE native_provider_accounts SET cooldown_until = ?1 WHERE id = ?2",
                params![now_seconds() - 5, &ids[0]],
            )
            .expect("expire cooldown");
        }
        let ordered = ProviderAccountService::candidates(provider, None).expect("candidates");
        let got: Vec<&str> = ordered.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(
            got,
            vec![ids[0].as_str(), ids[3].as_str(), ids[2].as_str()],
            "an expired cooldown re-admits the account as healthy (created order)"
        );

        // Sanity: the auth_expired row is still persisted as such.
        let record = ProviderAccountService::get_record(&ids[1])
            .expect("get record")
            .expect("row exists");
        assert_eq!(record.health, HEALTH_AUTH_EXPIRED);
    }
}
