//! Outcome recording, provider-error classification, health aggregates,
//! account testing, and per-account usage aggregates.
//!
//! Owns the in-memory OMP virtual-account health map (OMP accounts have no
//! DB row to persist to; OMP owns and refreshes those credentials
//! out-of-process).

use std::collections::HashMap;
use std::sync::LazyLock;

use parking_lot::Mutex;
use rusqlite::{params, OptionalExtension};

use crate::models::native_chat::ProviderAccount;
use crate::services::storage_service::StorageService;

use super::{
    is_omp_account_id, now_seconds, omp_provider_of, selection, to_public, AccountOutcome,
    DbResult, ProviderAccountRecord, ProviderAccountService, AUTH_OAUTH,
    DEFAULT_RATE_LIMIT_COOLDOWN_SECS, HEALTH_AUTH_EXPIRED, HEALTH_ERROR, HEALTH_HEALTHY,
    HEALTH_RATE_LIMITED,
};

/// In-memory health for OMP virtual accounts (no DB row to persist to; OMP
/// owns and refreshes those credentials out-of-process).
static OMP_HEALTH: LazyLock<Mutex<HashMap<String, (String, Option<i64>, Option<String>)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Current `(health, cooldown_until, last_error)` for an OMP virtual account,
/// defaulting to healthy when no outcome has been recorded yet.
pub(super) fn omp_health_snapshot(account_id: &str) -> (String, Option<i64>, Option<String>) {
    OMP_HEALTH
        .lock()
        .get(account_id)
        .cloned()
        .unwrap_or((HEALTH_HEALTHY.to_string(), None, None))
}

/// Whether the OMP virtual account is currently selectable: healthy, or
/// rate-limited with an elapsed cooldown.
pub(super) fn omp_account_usable(account_id: &str, now: i64) -> bool {
    let health = OMP_HEALTH.lock();
    match health.get(account_id) {
        Some((state, cooldown, _)) => {
            state == HEALTH_HEALTHY
                || (state == HEALTH_RATE_LIMITED && cooldown.is_none_or(|until| until <= now))
        }
        None => true,
    }
}

/// Drop the in-memory health entry (the OMP account was logged out).
pub(super) fn clear_omp_health(account_id: &str) {
    OMP_HEALTH.lock().remove(account_id);
}

/// Classify a provider error message (as produced by `provider_http_error`
/// and the transport layers) into a health outcome.
pub fn classify_provider_error(message: &str) -> AccountOutcome {
    if message.contains("Rate limited (429") || message.contains("(429)") {
        return AccountOutcome::RateLimited(None);
    }
    if message.contains("Authentication failed (401")
        || message.contains("Authentication failed (403")
    {
        return AccountOutcome::AuthExpired(message.to_string());
    }
    AccountOutcome::TransportError(message.to_string())
}

/// Metric `error_class` string for a provider error message.
pub fn provider_error_class(message: &str) -> &'static str {
    match classify_provider_error(message) {
        AccountOutcome::RateLimited(_) => "rate_limited",
        AccountOutcome::AuthExpired(_) => "auth",
        _ => "provider_error",
    }
}

impl ProviderAccountService {
    // ─── Health ───

    pub fn record_outcome(account_id: &str, outcome: AccountOutcome) {
        let now = now_seconds();
        let (health, cooldown_until, last_error): (&str, Option<i64>, Option<String>) =
            match &outcome {
                AccountOutcome::Success => (HEALTH_HEALTHY, None, None),
                AccountOutcome::RateLimited(retry_after) => (
                    HEALTH_RATE_LIMITED,
                    Some(
                        now + retry_after
                            .unwrap_or(DEFAULT_RATE_LIMIT_COOLDOWN_SECS)
                            .max(1),
                    ),
                    None,
                ),
                AccountOutcome::AuthExpired(message) => {
                    (HEALTH_AUTH_EXPIRED, None, Some(message.clone()))
                }
                AccountOutcome::TransportError(message) => {
                    (HEALTH_ERROR, None, Some(message.clone()))
                }
            };
        if is_omp_account_id(account_id) {
            OMP_HEALTH.lock().insert(
                account_id.to_string(),
                (health.to_string(), cooldown_until, last_error),
            );
            return;
        }
        let Ok(conn) = StorageService::connect() else {
            return;
        };
        let _ = conn.execute(
            "UPDATE native_provider_accounts
             SET health = ?1, cooldown_until = ?2, last_error = ?3,
                 last_used_at = ?4, updated_at = ?4
             WHERE id = ?5",
            params![health, cooldown_until, last_error, now, account_id],
        );
        // A newly unhealthy sticky account releases its sessions so the next
        // request re-selects.
        if health != HEALTH_HEALTHY {
            selection::release_sticky_for_account(account_id);
        }
    }

    /// Aggregate provider health for catalog surfaces:
    /// "healthy" (every account fine or no accounts), "degraded" (some
    /// broken), "broken" (all accounts unusable).
    pub fn aggregate_health(provider_id: &str) -> DbResult<String> {
        let records = Self::list_records(Some(provider_id))?;
        if records.is_empty() {
            return Ok(HEALTH_HEALTHY.to_string());
        }
        let now = now_seconds();
        let usable = |record: &ProviderAccountRecord| {
            record.health == HEALTH_HEALTHY
                || (record.health == HEALTH_RATE_LIMITED
                    && record.cooldown_until.is_none_or(|until| until <= now))
        };
        let usable_count = records.iter().filter(|r| usable(r)).count();
        Ok(if usable_count == records.len() {
            HEALTH_HEALTHY.to_string()
        } else if usable_count > 0 {
            "degraded".to_string()
        } else {
            "broken".to_string()
        })
    }

    /// Per-account usage aggregates for a provider over the trailing window.
    /// Every known account appears (zeros when idle); rows recorded before
    /// the multi-account migration aggregate under `account_id: None`.
    pub fn account_usage(
        provider_id: &str,
        window_secs: i64,
    ) -> DbResult<Vec<crate::models::native_chat::ProviderAccountUsage>> {
        use crate::models::native_chat::ProviderAccountUsage;
        let conn = StorageService::connect()?;
        let since = now_seconds() - window_secs.max(0);
        let mut stmt = conn
            .prepare(
                "SELECT account_id, COUNT(*), COALESCE(SUM(input_tokens), 0),
                        COALESCE(SUM(output_tokens), 0), COALESCE(SUM(COALESCE(cost_total, 0)), 0)
                 FROM native_request_metrics
                 WHERE provider_id = ?1 AND created_at > ?2
                 GROUP BY account_id",
            )
            .map_err(|e| e.to_string())?;
        let mut usage: Vec<ProviderAccountUsage> = stmt
            .query_map(params![provider_id, since], |row| {
                Ok(ProviderAccountUsage {
                    account_id: row.get(0)?,
                    requests: row.get(1)?,
                    input_tokens: row.get(2)?,
                    output_tokens: row.get(3)?,
                    cost_total: row.get(4)?,
                    request_share: 0.0,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        // Idle accounts still get a row (spec: zeros rather than hidden).
        for account in Self::list_accounts(provider_id)? {
            if !usage
                .iter()
                .any(|u| u.account_id.as_deref() == Some(account.id.as_str()))
            {
                usage.push(ProviderAccountUsage {
                    account_id: Some(account.id),
                    requests: 0,
                    input_tokens: 0,
                    output_tokens: 0,
                    cost_total: 0.0,
                    request_share: 0.0,
                });
            }
        }
        let total: i64 = usage.iter().map(|u| u.requests).sum();
        if total > 0 {
            for row in usage.iter_mut() {
                row.request_share = row.requests as f64 / total as f64;
            }
        }
        usage.sort_by(|a, b| b.requests.cmp(&a.requests));
        Ok(usage)
    }

    /// Minimal authenticated request proving an account still works, updating
    /// its health with the outcome. OAuth accounts exchange their refresh
    /// token; API-key accounts hit the provider's models endpoint; OMP
    /// accounts re-resolve their token through OMP.
    pub fn test_account(account_id: &str) -> DbResult<ProviderAccount> {
        if let Some(provider_id) = omp_provider_of(account_id) {
            let ok = crate::services::native_chat_service::NativeChatService::omp_credential_for(
                provider_id,
            )
            .is_some();
            Self::record_outcome(
                account_id,
                if ok {
                    AccountOutcome::Success
                } else {
                    AccountOutcome::AuthExpired(
                        "Oh My Pi no longer holds a credential for this provider. Run /login in Oh My Pi.".to_string(),
                    )
                },
            );
            let omp = crate::services::native_chat_service::NativeChatService::omp_credential_for(
                provider_id,
            );
            return Ok(super::omp_virtual_account(
                provider_id,
                omp.as_ref()
                    .map(|c| c.label.as_str())
                    .unwrap_or("unavailable"),
                omp.as_ref().map(|c| c.updated_at).unwrap_or_default(),
            ));
        }
        let mut record = Self::get_record(account_id)?
            .ok_or_else(|| format!("Unknown account '{account_id}'."))?;
        let result: Result<(), String> = match record.auth_method.as_str() {
            AUTH_OAUTH => {
                crate::services::provider_login_service::ProviderLoginService::test_codex_account(
                    &mut record,
                )
            }
            _ => Self::test_api_key(&record),
        };
        match result {
            Ok(()) => Self::record_outcome(account_id, AccountOutcome::Success),
            Err(message) => Self::record_outcome(account_id, classify_provider_error(&message)),
        }
        let refreshed = Self::get_record(account_id)?
            .ok_or_else(|| format!("Unknown account '{account_id}'."))?;
        Ok(to_public(refreshed))
    }

    /// GET the provider's models endpoint with this account's key.
    fn test_api_key(record: &ProviderAccountRecord) -> Result<(), String> {
        let base_url = match record.base_url.clone() {
            Some(url) if !url.starts_with("omp://") && !url.starts_with("native://") => url,
            _ => {
                let conn = StorageService::connect()?;
                conn.query_row(
                    "SELECT base_url FROM native_provider_model_cache
                     WHERE provider_id = ?1 AND base_url != '' LIMIT 1",
                    params![&record.provider_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "This provider has no testable HTTP endpoint.".to_string())?
            }
        };
        let url = format!("{}/models", base_url.trim_end_matches('/'));
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|error| format!("Failed to build test client: {error}"))?;
        let response = client
            .get(&url)
            .bearer_auth(&record.api_key)
            .send()
            .map_err(|error| {
                format!("Provider '{}' request failed: {error}", record.provider_id)
            })?;
        let status = response.status().as_u16();
        match status {
            200..=299 => Ok(()),
            401 | 403 => Err(format!(
                "Authentication failed ({status}) for '{}'. Reconnect the provider or check the API key.",
                record.provider_id
            )),
            429 => Err(format!(
                "Rate limited ({status}) by '{}'. Try again shortly.",
                record.provider_id
            )),
            _ => Err(format!(
                "Provider '{}' request failed ({status}).",
                record.provider_id
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test::isolated_home;

    /// Pin the exact transport-layer message formats `classify_provider_error`
    /// parses. These are substring matches on unstructured text (see review
    /// note): if `test_api_key` / `provider_http_error` ever change their
    /// wording, this test must fail so health classification is re-verified
    /// instead of silently degrading to `TransportError`.
    #[test]
    fn classify_provider_error_pins_message_formats() {
        // The exact 429 shape produced by `test_api_key`.
        assert!(matches!(
            classify_provider_error("Rate limited (429) by 'openai'. Try again shortly."),
            AccountOutcome::RateLimited(None)
        ));
        // Any "(429)" mention classifies as rate-limited.
        assert!(matches!(
            classify_provider_error("Provider 'x' request failed (429)."),
            AccountOutcome::RateLimited(None)
        ));
        // The exact 401/403 shapes produced by `test_api_key`.
        assert!(matches!(
            classify_provider_error(
                "Authentication failed (401) for 'openai'. Reconnect the provider or check the API key."
            ),
            AccountOutcome::AuthExpired(_)
        ));
        assert!(matches!(
            classify_provider_error("Authentication failed (403) for 'xai'."),
            AccountOutcome::AuthExpired(_)
        ));
        // Everything else falls through to transport.
        assert!(matches!(
            classify_provider_error("Provider 'openai' request failed (500)."),
            AccountOutcome::TransportError(_)
        ));
        assert!(matches!(
            classify_provider_error("connection reset by peer"),
            AccountOutcome::TransportError(_)
        ));

        // Metric classes track the same mapping.
        assert_eq!(
            provider_error_class("Rate limited (429) by 'p'."),
            "rate_limited"
        );
        assert_eq!(
            provider_error_class("Authentication failed (401) for 'p'."),
            "auth"
        );
        assert_eq!(
            provider_error_class("Provider 'p' request failed (500)."),
            "provider_error"
        );
    }

    /// The persisted health state machine: healthy → rate_limited (with a
    /// cooldown) → healthy again on success; auth_expired and error record
    /// their message; a missing Retry-After falls back to the default
    /// cooldown.
    #[test]
    fn record_outcome_drives_persisted_health_transitions() {
        let (_dir, _guard) = isolated_home();
        let (record, _) = ProviderAccountService::upsert_account(
            "test-outcome-provider",
            "acct",
            "api",
            "sk-outcome",
            None,
            "sk256:outcome",
        )
        .expect("seed account");
        let id = record.id;

        // 429 with Retry-After.
        ProviderAccountService::record_outcome(&id, AccountOutcome::RateLimited(Some(120)));
        let row = ProviderAccountService::get_record(&id).unwrap().unwrap();
        assert_eq!(row.health, HEALTH_RATE_LIMITED);
        let until = row.cooldown_until.expect("cooldown set");
        let now = now_seconds();
        assert!(
            (until - now - 120).abs() <= 2,
            "cooldown ≈ now + retry_after"
        );

        // 429 without Retry-After → default cooldown.
        ProviderAccountService::record_outcome(&id, AccountOutcome::RateLimited(None));
        let row = ProviderAccountService::get_record(&id).unwrap().unwrap();
        let until = row.cooldown_until.expect("cooldown set");
        let now = now_seconds();
        assert!(
            (until - now - DEFAULT_RATE_LIMIT_COOLDOWN_SECS).abs() <= 2,
            "missing Retry-After falls back to the default cooldown"
        );

        // Auth failure records the message and drops the cooldown.
        ProviderAccountService::record_outcome(
            &id,
            AccountOutcome::AuthExpired("Authentication failed (401) for 'p'.".to_string()),
        );
        let row = ProviderAccountService::get_record(&id).unwrap().unwrap();
        assert_eq!(row.health, HEALTH_AUTH_EXPIRED);
        assert_eq!(row.cooldown_until, None);
        assert!(row.last_error.as_deref().unwrap().contains("(401)"));

        // Success resets everything.
        ProviderAccountService::record_outcome(&id, AccountOutcome::Success);
        let row = ProviderAccountService::get_record(&id).unwrap().unwrap();
        assert_eq!(row.health, HEALTH_HEALTHY);
        assert_eq!(row.cooldown_until, None);
        assert_eq!(row.last_error, None);
        assert!(row.last_used_at.is_some(), "outcomes stamp last_used_at");
    }

    /// Aggregate health rolls the per-account states up for catalog surfaces.
    #[test]
    fn aggregate_health_reports_degraded_and_broken() {
        let (_dir, _guard) = isolated_home();
        let provider = "test-aggregate-provider";
        let (a, _) = ProviderAccountService::upsert_account(
            provider,
            "a",
            "api",
            "sk-agg-a",
            None,
            "sk256:agg:a",
        )
        .expect("seed a");
        let (b, _) = ProviderAccountService::upsert_account(
            provider,
            "b",
            "api",
            "sk-agg-b",
            None,
            "sk256:agg:b",
        )
        .expect("seed b");

        assert_eq!(
            ProviderAccountService::aggregate_health(provider).unwrap(),
            "healthy"
        );

        ProviderAccountService::record_outcome(
            &a.id,
            AccountOutcome::TransportError("boom".to_string()),
        );
        assert_eq!(
            ProviderAccountService::aggregate_health(provider).unwrap(),
            "degraded"
        );

        ProviderAccountService::record_outcome(
            &b.id,
            AccountOutcome::AuthExpired("Authentication failed (401) for 'p'.".to_string()),
        );
        assert_eq!(
            ProviderAccountService::aggregate_health(provider).unwrap(),
            "broken"
        );
    }
}
