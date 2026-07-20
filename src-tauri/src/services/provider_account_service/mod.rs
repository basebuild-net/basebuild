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
//!
//! The service is one façade ([`ProviderAccountService`]) over three domain
//! modules:
//! - [`storage`] — CRUD, legacy migration, and the compat-table sync.
//! - [`selection`] — strategy resolution and the ordered candidate list.
//! - [`health`] — outcome recording, error classification, usage aggregates.

mod health;
mod selection;
mod storage;

pub use health::{classify_provider_error, provider_error_class};

use sha2::{Digest, Sha256};

use crate::models::native_chat::ProviderAccount;

pub(crate) type DbResult<T> = Result<T, String>;

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

/// Façade over the account domain. Method groups live in the domain modules:
/// CRUD/migration in [`storage`], candidate ordering in [`selection`], and
/// outcome/health/usage in [`health`].
pub struct ProviderAccountService;

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
    let (health, cooldown_until, last_error) = health::omp_health_snapshot(&id);
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
