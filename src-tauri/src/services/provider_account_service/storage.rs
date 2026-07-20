//! Account CRUD, the one-shot legacy migration, and the compat-table sync.
//!
//! Owns the migration guards (`MIGRATED` + `MIGRATION_LOCK`). Everything here
//! is plain row storage; ordering and health semantics live in the sibling
//! `selection` and `health` modules.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};

use crate::models::native_chat::ProviderAccount;
use crate::services::storage_service::StorageService;

use super::{
    api_key_identity, classify_auth, gen_id, health, now_seconds, omp_provider_of, selection,
    to_public, DbResult, ProviderAccountRecord, ProviderAccountService, AUTH_OAUTH,
};

static MIGRATED: AtomicBool = AtomicBool::new(false);
static MIGRATION_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

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
    /// virtual accounts; see [`Self::list_accounts`] for the merged public view.
    pub fn list_records(provider_id: Option<&str>) -> DbResult<Vec<ProviderAccountRecord>> {
        Self::ensure_migrated();
        let conn = StorageService::connect()?;
        Self::list_records_with_conn(&conn, provider_id)
    }

    pub(super) fn list_records_with_conn(
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
                accounts.push(super::omp_virtual_account(
                    provider_id,
                    &omp.label,
                    omp.updated_at,
                ));
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
                     SET label = ?1, api_key = ?2, base_url = ?3, health = 'healthy', status = 'active',
                         cooldown_until = NULL, last_error = NULL, updated_at = ?4
                     WHERE id = ?5",
                    params![label, api_key, base_url, now, &id],
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
        if super::is_omp_account_id(account_id) {
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
            health::clear_omp_health(account_id);
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
        selection::release_sticky_for_account(account_id);
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test::isolated_home;

    /// Task 1.4: `ensure_migrated` must be idempotent — running it twice must
    /// not duplicate rows, not error, and leave the accounts table reflecting
    /// the single legacy credential. The in-process `MIGRATED` flag is reset
    /// to force the second pass through the actual migration code path.
    #[test]
    fn ensure_migrated_is_idempotent() {
        let (_dir, _guard) = isolated_home();

        // Seed a legacy credential row as if the user connected before upgrade.
        {
            let conn = StorageService::connect().expect("connect for seed");
            conn.execute(
                "INSERT INTO native_provider_credentials
                   (provider_id, label, api_key, base_url, updated_at)
                 VALUES ('openai', 'OpenAI', 'sk-test-1234', NULL, 0)",
                [],
            )
            .expect("seed legacy credential");
        }
        // Reset the in-process guard so the migration actually runs (a prior
        // test may have set it). The static is process-scoped, not per-DB.
        MIGRATED.store(false, Ordering::Release);
        // First migration: copies the legacy row into the accounts table.
        ProviderAccountService::ensure_migrated();
        let rows = ProviderAccountService::list_records(Some("openai"))
            .expect("list after first migration");
        assert_eq!(rows.len(), 1, "first migration should produce one account row");
        assert_eq!(rows[0].api_key, "sk-test-1234");

        // Reset the in-process guard and run again. The UNIQUE(provider_id,
        // identity_key) index + the `existing_id` check in upsert must keep
        // this a no-op rather than duplicating.
        MIGRATED.store(false, Ordering::Release);
        ProviderAccountService::ensure_migrated();

        let rows_again = ProviderAccountService::list_records(Some("openai"))
            .expect("list after second migration");
        assert_eq!(
            rows_again.len(),
            1,
            "second migration must not duplicate the account row"
        );
        assert_eq!(rows_again[0].api_key, "sk-test-1234");
    }

    /// Task 1.4 companion: upserting the same identity twice updates in place
    /// rather than inserting a duplicate (the dedup contract).
    #[test]
    fn upsert_account_dedupes_by_identity() {
        let (_dir, _guard) = isolated_home();

        let (first, updated_first) = ProviderAccountService::upsert_account(
            "anthropic",
            "Claude",
            "api",
            "sk-aaa",
            None,
            "sk256:abc",
        )
        .expect("first upsert");
        assert!(!updated_first, "first upsert should be an insert");

        let (second, updated_second) = ProviderAccountService::upsert_account(
            "anthropic",
            "Claude (renamed)",
            "api",
            "sk-aaa",
            None,
            "sk256:abc",
        )
        .expect("second upsert");
        assert!(updated_second, "second upsert should be an update");
        assert_eq!(first.id, second.id, "dedup must reuse the same row id");
        assert_eq!(second.label, "Claude (renamed)");

        let rows = ProviderAccountService::list_records(Some("anthropic"))
            .expect("list after dedup");
        assert_eq!(rows.len(), 1, "only one row for the identity");
    }
}
