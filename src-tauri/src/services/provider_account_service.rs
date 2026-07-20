//! Multi-account provider credentials: storage-backed account CRUD, identity
//! dedupe, per-account health tracking, and request-time account selection.
//!
//! Providers hold zero or more accounts in `native_provider_accounts`. Each
//! account carries its own credential (API key or OAuth access token), an
//! `identity_key` that dedupes logins resolving to the same upstream identity
//! (ChatGPT account id for Codex OAuth, SHA-256 of the key for API keys), and
//! a persisted health state driven by request outcomes. Oh My Pi credentials
//! surface as *virtual* accounts (id `omp:<provider>`): they are listed and
//! selectable, but their secret material stays owned by OMP and their health
//! is tracked in-memory only.
//!
//! The legacy single-row `native_provider_credentials` table remains a
//! compatibility view of each provider's newest account for one release
//! (rollback window); `migrate_legacy_credentials` copies it forward exactly
//! once and never deletes from it.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::models::native_chat::ProviderAccount;
use crate::services::storage_service::StorageService;

type DbResult<T> = Result<T, String>;

pub const AUTH_OAUTH: &str = "oauth";
pub const AUTH_API: &str = "api";
pub const AUTH_OMP: &str = "omp";

pub const HEALTH_HEALTHY: &str = "healthy";
pub const HEALTH_RATE_LIMITED: &str = "rate_limited";
pub const HEALTH_AUTH_EXPIRED: &str = "auth_expired";
pub const HEALTH_ERROR: &str = "error";

/// Default cooldown applied to a 429 without a usable Retry-After header.
pub const DEFAULT_RATE_LIMIT_COOLDOWN_SECS: i64 = 60;

const OMP_ACCOUNT_PREFIX: &str = "omp:";

/// Full account row including secret material. Never serialized to the
/// frontend — the UI sees [`ProviderAccount`] via [`to_public`].
#[derive(Debug, Clone)]
pub struct ProviderAccountRecord {
    pub id: String,
    pub provider_id: String,
    pub label: String,
    pub auth_method: String,
    pub api_key: String,
    pub base_url: Option<String>,
    pub identity_key: Option<String>,
    pub health: String,
    pub cooldown_until: Option<i64>,
    pub last_error: Option<String>,
    pub last_used_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectionStrategy {
    RoundRobin,
    StickySession,
    FillFirst,
}

impl SelectionStrategy {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "round_robin" => Some(Self::RoundRobin),
            "sticky_session" => Some(Self::StickySession),
            "fill_first" => Some(Self::FillFirst),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::RoundRobin => "round_robin",
            Self::StickySession => "sticky_session",
            Self::FillFirst => "fill_first",
        }
    }
}

/// Request outcome classification fed back into account health.
#[derive(Debug, Clone)]
pub enum AccountOutcome {
    Success,
    /// 429 — cooldown in seconds when the response carried Retry-After.
    RateLimited(Option<i64>),
    /// 401/403 after a refresh attempt — needs re-login.
    AuthExpired(String),
    /// Transport / 5xx failure.
    TransportError(String),
}

static MIGRATED: AtomicBool = AtomicBool::new(false);
static MIGRATION_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
/// Round-robin cursor per provider (in-memory by design; health persists, the
/// rotation position does not need to survive restarts).
static RR_CURSORS: LazyLock<Mutex<HashMap<String, usize>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// Sticky-session assignment: session key → account id.
static STICKY_ACCOUNTS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// In-memory health for OMP virtual accounts (no DB row to persist to; OMP
/// owns and refreshes those credentials out-of-process).
static OMP_HEALTH: LazyLock<Mutex<HashMap<String, (String, Option<i64>, Option<String>)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

const STRATEGY_GLOBAL_KEY: &str = "provider_account_strategy";

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn gen_id(prefix: &str) -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{prefix}_{ts:x}")
}

/// SHA-256 hex of an API key — a stable identity that avoids storing the key
/// twice while letting byte-identical keys dedupe.
pub fn api_key_identity(api_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(api_key.as_bytes());
    format!("sk256:{:x}", hasher.finalize())
}

/// Masked fingerprint for display: "sk-…4f2a".
pub fn masked_key_label(api_key: &str) -> String {
    let tail: String = api_key
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("key …{tail}")
}

pub fn is_omp_account_id(account_id: &str) -> bool {
    account_id.starts_with(OMP_ACCOUNT_PREFIX)
}

pub fn omp_account_id(provider_id: &str) -> String {
    format!("{OMP_ACCOUNT_PREFIX}{provider_id}")
}

pub fn omp_provider_of(account_id: &str) -> Option<&str> {
    account_id.strip_prefix(OMP_ACCOUNT_PREFIX)
}

pub struct ProviderAccountService;

impl ProviderAccountService {
    // ─── Migration ───

    /// Idempotent forward migration: copy each legacy
    /// `native_provider_credentials` row into an account row and mirror the
    /// single-slot Codex OAuth token into its per-account key. Never deletes
    /// legacy data (rollback window). Guarded by an in-process flag plus the
    /// `identity_key` UNIQUE index, so re-running is a no-op.
    pub fn ensure_migrated() {
        if MIGRATED.load(Ordering::Acquire) {
            return;
        }
        let _guard = MIGRATION_LOCK.lock();
        if MIGRATED.load(Ordering::Acquire) {
            return;
        }
        if let Err(error) = Self::migrate_legacy_credentials() {
            // Non-fatal: dual-read in list paths falls back to the legacy row.
            eprintln!("[provider-accounts] legacy migration failed: {error}");
        }
        MIGRATED.store(true, Ordering::Release);
    }

    fn migrate_legacy_credentials() -> DbResult<()> {
        let conn = StorageService::connect()?;
        let legacy: Vec<(String, String, String, Option<String>, i64)> = conn
            .prepare(
                "SELECT provider_id, label, api_key, base_url, updated_at
                 FROM native_provider_credentials",
            )
            .map_err(|e| e.to_string())?
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        for (provider_id, label, api_key, base_url, updated_at) in legacy {
            // A provider that already has account rows is post-migration.
            let existing: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM native_provider_accounts WHERE provider_id = ?1",
                    params![&provider_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if existing > 0 {
                continue;
            }
            let auth_method = classify_auth(base_url.as_deref());
            let identity_key = match auth_method {
                AUTH_OAUTH => {
                    crate::services::provider_client::codex_account_identity(&api_key)
                        .unwrap_or_else(|| format!("legacy:{provider_id}"))
                }
                _ => api_key_identity(&api_key),
            };
            let now = now_seconds();
            conn.execute(
                "INSERT OR IGNORE INTO native_provider_accounts
                   (id, provider_id, label, credential_owner, status, metadata,
                    api_key, base_url, auth_method, identity_key, health,
                    created_at, updated_at)
                 VALUES (?1, ?2, ?3, 'basebuild', 'active', '{}', ?4, ?5, ?6, ?7, 'healthy', ?8, ?8)",
                params![
                    gen_id("pacct"),
                    &provider_id,
                    &label,
                    &api_key,
                    &base_url,
                    auth_method,
                    &identity_key,
                    if updated_at > 0 { updated_at } else { now },
                ],
            )
            .map_err(|e| format!("Failed to migrate credential for {provider_id}: {e}"))?;

            // Mirror the single-slot Codex token to its per-account key so
            // per-account refresh finds it. The legacy key stays for rollback.
            if auth_method == AUTH_OAUTH && provider_id == "openai-codex" {
                let legacy_token: Option<String> = conn
                    .query_row(
                        "SELECT value FROM app_defaults WHERE key = 'provider_oauth:openai-codex'",
                        [],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
                if let Some(token_json) = legacy_token {
                    conn.execute(
                        "INSERT OR IGNORE INTO app_defaults (key, value) VALUES (?1, ?2)",
                        params![
                            format!("provider_oauth:openai-codex:{identity_key}"),
                            token_json
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(())
    }

    // ─── CRUD ───

    /// Stored (Basebuild-owned) account rows, newest first. Excludes OMP
    /// virtual accounts; see [`list_accounts`] for the merged public view.
    pub fn list_records(provider_id: Option<&str>) -> DbResult<Vec<ProviderAccountRecord>> {
        Self::ensure_migrated();
        let conn = StorageService::connect()?;
        Self::list_records_with_conn(&conn, provider_id)
    }

    fn list_records_with_conn(
        conn: &Connection,
        provider_id: Option<&str>,
    ) -> DbResult<Vec<ProviderAccountRecord>> {
        let sql = "SELECT id, provider_id, label, auth_method, api_key, base_url, identity_key,
                          health, cooldown_until, last_error, last_used_at, created_at, updated_at
                   FROM native_provider_accounts
                   WHERE status = 'active' AND api_key IS NOT NULL
                     AND (?1 IS NULL OR provider_id = ?1)
                   ORDER BY created_at ASC";
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![provider_id], |row| {
                Ok(ProviderAccountRecord {
                    id: row.get(0)?,
                    provider_id: row.get(1)?,
                    label: row.get(2)?,
                    auth_method: row.get(3)?,
                    api_key: row.get(4)?,
                    base_url: row.get(5)?,
                    identity_key: row.get(6)?,
                    health: row.get(7)?,
                    cooldown_until: row.get(8)?,
                    last_error: row.get(9)?,
                    last_used_at: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// Public account list for one provider: stored rows plus the OMP virtual
    /// account when OMP has a usable credential and the provider isn't
    /// blocked. Secrets are stripped.
    pub fn list_accounts(provider_id: &str) -> DbResult<Vec<ProviderAccount>> {
        let mut accounts: Vec<ProviderAccount> = Self::list_records(Some(provider_id))?
            .into_iter()
            .map(to_public)
            .collect();
        if let Some(omp) =
            crate::services::native_chat_service::NativeChatService::omp_credential_for(
                provider_id,
            )
        {
            if !Self::is_provider_blocked(provider_id)? {
                accounts.push(omp_virtual_account(provider_id, &omp.label, omp.updated_at));
            }
        }
        Ok(accounts)
    }

    pub fn is_provider_blocked(provider_id: &str) -> DbResult<bool> {
        let conn = StorageService::connect()?;
        let blocked: Option<i64> = conn
            .query_row(
                "SELECT blocked_at FROM native_blocked_providers WHERE provider_id = ?1",
                params![provider_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(blocked.is_some())
    }

    /// Upsert an account by identity. Returns `(record, updated)` where
    /// `updated` is true when an existing identity was refreshed in place
    /// (spec: "account updated" vs "account added").
    pub fn upsert_account(
        provider_id: &str,
        label: &str,
        auth_method: &str,
        api_key: &str,
        base_url: Option<&str>,
        identity_key: &str,
    ) -> DbResult<(ProviderAccountRecord, bool)> {
        Self::ensure_migrated();
        let conn = StorageService::connect()?;
        let existing_id: Option<String> = conn
            .query_row(
                "SELECT id FROM native_provider_accounts
                 WHERE provider_id = ?1 AND identity_key = ?2",
                params![provider_id, identity_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let now = now_seconds();
        let (id, updated) = match existing_id {
            Some(id) => {
                conn.execute(
                    "UPDATE native_provider_accounts
                     SET api_key = ?1, base_url = ?2, health = 'healthy', status = 'active',
                         cooldown_until = NULL, last_error = NULL, updated_at = ?3
                     WHERE id = ?4",
                    params![api_key, base_url, now, &id],
                )
                .map_err(|e| e.to_string())?;
                (id, true)
            }
            None => {
                let id = gen_id("pacct");
                conn.execute(
                    "INSERT INTO native_provider_accounts
                       (id, provider_id, label, credential_owner, status, metadata,
                        api_key, base_url, auth_method, identity_key, health,
                        created_at, updated_at)
                     VALUES (?1, ?2, ?3, 'basebuild', 'active', '{}', ?4, ?5, ?6, ?7, 'healthy', ?8, ?8)",
                    params![&id, provider_id, label, api_key, base_url, auth_method, identity_key, now],
                )
                .map_err(|e| e.to_string())?;
                (id, false)
            }
        };
        let record = Self::get_record_with_conn(&conn, &id)?
            .ok_or_else(|| "Account row disappeared during upsert.".to_string())?;
        Ok((record, updated))
    }

    pub fn get_record(account_id: &str) -> DbResult<Option<ProviderAccountRecord>> {
        let conn = StorageService::connect()?;
        Self::get_record_with_conn(&conn, account_id)
    }

    fn get_record_with_conn(
        conn: &Connection,
        account_id: &str,
    ) -> DbResult<Option<ProviderAccountRecord>> {
        let mut stmt = conn
            .prepare(
                "SELECT id, provider_id, label, auth_method, api_key, base_url, identity_key,
                        health, cooldown_until, last_error, last_used_at, created_at, updated_at
                 FROM native_provider_accounts WHERE id = ?1",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![account_id], |row| {
            Ok(ProviderAccountRecord {
                id: row.get(0)?,
                provider_id: row.get(1)?,
                label: row.get(2)?,
                auth_method: row.get(3)?,
                api_key: row.get(4)?,
                base_url: row.get(5)?,
                identity_key: row.get(6)?,
                health: row.get(7)?,
                cooldown_until: row.get(8)?,
                last_error: row.get(9)?,
                last_used_at: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn set_label(account_id: &str, label: &str) -> DbResult<()> {
        let label = label.trim();
        if label.is_empty() {
            return Err("Account label is required.".to_string());
        }
        if is_omp_account_id(account_id) {
            return Err("Oh My Pi accounts are labeled by Oh My Pi.".to_string());
        }
        let conn = StorageService::connect()?;
        let changed = conn
            .execute(
                "UPDATE native_provider_accounts SET label = ?1, updated_at = ?2 WHERE id = ?3",
                params![label, now_seconds(), account_id],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err(format!("Unknown account '{account_id}'."));
        }
        Ok(())
    }

    /// Log out one account. Sibling accounts on the same provider are
    /// untouched. OMP virtual accounts are "logged out" by blocking OMP
    /// re-import for the provider (their secret lives in OMP's store).
    pub fn remove_account(account_id: &str) -> DbResult<()> {
        Self::ensure_migrated();
        let conn = StorageService::connect()?;
        if let Some(provider_id) = omp_provider_of(account_id) {
            conn.execute(
                "INSERT OR IGNORE INTO native_blocked_providers (provider_id, blocked_at) VALUES (?1, ?2)",
                params![provider_id, now_seconds()],
            )
            .map_err(|e| e.to_string())?;
            OMP_HEALTH.lock().remove(account_id);
            let _ = crate::services::provider_model_catalog_service::ProviderModelCatalogService::refresh_provider(provider_id, true);
            return Ok(());
        }
        let Some(record) = Self::get_record_with_conn(&conn, account_id)? else {
            return Err(format!("Unknown account '{account_id}'."));
        };
        conn.execute(
            "DELETE FROM native_provider_accounts WHERE id = ?1",
            params![account_id],
        )
        .map_err(|e| e.to_string())?;
        // Drop the account's own OAuth token slot.
        if record.auth_method == AUTH_OAUTH {
            if let Some(identity) = record.identity_key.as_deref() {
                let _ = conn.execute(
                    "DELETE FROM app_defaults WHERE key = ?1",
                    params![format!("provider_oauth:{}:{identity}", record.provider_id)],
                );
            }
        }
        STICKY_ACCOUNTS.lock().retain(|_, v| v != account_id);
        Self::sync_legacy_row(&conn, &record.provider_id)?;
        let _ = crate::services::provider_model_catalog_service::ProviderModelCatalogService::refresh_provider(&record.provider_id, true);
        Ok(())
    }

    /// Keep the legacy compat table pointing at the provider's newest account
    /// (rollback window for pre-multi-account builds).
    pub(crate) fn sync_legacy_row(conn: &Connection, provider_id: &str) -> DbResult<()> {
        let records = Self::list_records_with_conn(conn, Some(provider_id))?;
        match records.iter().max_by_key(|r| r.updated_at) {
            Some(newest) => {
                conn.execute(
                    "INSERT INTO native_provider_credentials (provider_id, label, api_key, base_url, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(provider_id) DO UPDATE SET
                       label = excluded.label, api_key = excluded.api_key,
                       base_url = excluded.base_url, updated_at = excluded.updated_at",
                    params![provider_id, &newest.label, &newest.api_key, &newest.base_url, newest.updated_at],
                )
                .map_err(|e| e.to_string())?;
            }
            None => {
                conn.execute(
                    "DELETE FROM native_provider_credentials WHERE provider_id = ?1",
                    params![provider_id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

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
                                let cursor =
                                    cursors.entry(provider_id.to_string()).or_insert(0);
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
            crate::services::native_chat_service::NativeChatService::omp_credential_for(
                provider_id,
            )
        {
            if !Self::is_provider_blocked(provider_id)? {
                let virtual_id = omp_account_id(provider_id);
                let omp_ok = {
                    let health = OMP_HEALTH.lock();
                    match health.get(&virtual_id) {
                        Some((state, cooldown, _)) => {
                            state == HEALTH_HEALTHY
                                || (state == HEALTH_RATE_LIMITED
                                    && cooldown.is_none_or(|until| until <= now))
                        }
                        None => true,
                    }
                };
                if omp_ok {
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

    // ─── Health ───

    pub fn record_outcome(account_id: &str, outcome: AccountOutcome) {
        let now = now_seconds();
        let (health, cooldown_until, last_error): (&str, Option<i64>, Option<String>) =
            match &outcome {
                AccountOutcome::Success => (HEALTH_HEALTHY, None, None),
                AccountOutcome::RateLimited(retry_after) => (
                    HEALTH_RATE_LIMITED,
                    Some(now + retry_after.unwrap_or(DEFAULT_RATE_LIMIT_COOLDOWN_SECS).max(1)),
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
            STICKY_ACCOUNTS.lock().retain(|_, v| v != account_id);
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
}

fn classify_auth(base_url: Option<&str>) -> &'static str {
    match base_url {
        Some(crate::services::provider_client::NATIVE_CODEX_BASE_URL) => AUTH_OAUTH,
        Some(url) if url.starts_with("omp://") => AUTH_OMP,
        _ => AUTH_API,
    }
}

fn to_public(record: ProviderAccountRecord) -> ProviderAccount {
    ProviderAccount {
        id: record.id,
        provider_id: record.provider_id,
        label: record.label,
        auth_method: record.auth_method,
        health: record.health,
        cooldown_until: record.cooldown_until,
        last_error: record.last_error,
        last_used_at: record.last_used_at,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

fn omp_virtual_account(provider_id: &str, label: &str, updated_at: i64) -> ProviderAccount {
    let id = omp_account_id(provider_id);
    let (health, cooldown_until, last_error) = OMP_HEALTH
        .lock()
        .get(&id)
        .cloned()
        .unwrap_or((HEALTH_HEALTHY.to_string(), None, None));
    ProviderAccount {
        id,
        provider_id: provider_id.to_string(),
        label: format!("Oh My Pi · {label}"),
        auth_method: AUTH_OMP.to_string(),
        health,
        cooldown_until,
        last_error,
        last_used_at: None,
        created_at: updated_at,
        updated_at,
    }
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
}

impl ProviderAccountService {
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
            let omp = crate::services::native_chat_service::NativeChatService::omp_credential_for(provider_id);
            return Ok(omp_virtual_account(
                provider_id,
                omp.as_ref().map(|c| c.label.as_str()).unwrap_or("unavailable"),
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
            Err(message) => {
                Self::record_outcome(account_id, classify_provider_error(&message))
            }
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
                .ok_or_else(|| {
                    "This provider has no testable HTTP endpoint.".to_string()
                })?
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
            .map_err(|error| format!("Provider '{}' request failed: {error}", record.provider_id))?;
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
