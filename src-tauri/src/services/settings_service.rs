use rusqlite::params;

use crate::{
    models::{
        permission::{AuditEntry, PermissionRules, UsageSyncSettings},
        runtime::{RuntimeDefaults, RuntimeProfile, RuntimeProfileKind, WorkingDirectoryMode},
    },
    services::process_helpers::hidden_command,
    services::storage_service::StorageService,
};
type DbResult<T> = Result<T, String>;

#[allow(dead_code)]
 fn gen_id() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{ts:x}")
}

#[allow(dead_code)]
 fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

#[derive(Debug, Default)]
pub struct SettingsService;

impl SettingsService {
    // ─── Runtime Profiles ───

    pub fn list_profiles() -> DbResult<Vec<RuntimeProfile>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, kind, label, executable, args, working_directory_mode, default_model, capabilities, built_in FROM runtime_profiles ORDER BY built_in DESC, label ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let args_str: String = row.get(4)?;
                let caps_str: String = row.get(7)?;
                Ok(RuntimeProfile {
                    id: row.get(0)?,
                    kind: RuntimeProfileKind::from_str(&row.get::<_, String>(1)?),
                    label: row.get(2)?,
                    executable: row.get(3)?,
                    args: serde_json::from_str(&args_str).unwrap_or_default(),
                    working_directory_mode: WorkingDirectoryMode::from_str(&row.get::<_, String>(5)?),
                    default_model: row.get(6)?,
                    capabilities: serde_json::from_str(&caps_str).unwrap_or_default(),
                    built_in: row.get::<_, i32>(8)? != 0,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    #[allow(dead_code)]
     pub fn get_profile(id: &str) -> DbResult<Option<RuntimeProfile>> {
        Ok(Self::list_profiles()?.into_iter().find(|p| p.id == id))
     }

    pub fn upsert_profile(profile: &RuntimeProfile) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO runtime_profiles (id, kind, label, executable, args, working_directory_mode, default_model, capabilities, built_in)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               kind = excluded.kind, label = excluded.label, executable = excluded.executable,
               args = excluded.args, working_directory_mode = excluded.working_directory_mode,
               default_model = excluded.default_model, capabilities = excluded.capabilities",
            params![
                profile.id,
                profile.kind.as_str(),
                profile.label,
                profile.executable,
                serde_json::to_string(&profile.args).unwrap_or_default(),
                profile.working_directory_mode.as_str(),
                profile.default_model,
                serde_json::to_string(&profile.capabilities).unwrap_or_default(),
                profile.built_in as i32,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_profile(id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute("DELETE FROM runtime_profiles WHERE id = ?1 AND built_in = 0", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    /// Built-in adapters whose chat runs inside this process (no external
    /// binary). They are always available regardless of PATH.
    pub fn is_internal_chat_profile(id: &str) -> bool {
        id == "basebuild-native"
    }

    /// Whether an adapter is currently available. Internal adapters are always
    /// available; external adapters are resolved on PATH (cheap, no spawn).
    pub fn profile_available(profile: &RuntimeProfile) -> bool {
        if Self::is_internal_chat_profile(&profile.id) {
            return true;
        }
        which::which(&profile.executable).is_ok()
    }

    pub fn validate_profile(profile: &RuntimeProfile) -> DbResult<ProfileValidation> {
        // The native harness runs in-process; it has no external binary to
        // probe. Report it as available so defaults never land on "unavailable".
        if Self::is_internal_chat_profile(&profile.id) {
            return Ok(ProfileValidation {
                valid: true,
                version: Some("Built-in (local, in-process)".to_string()),
                error: None,
            });
        }
        // Executables don't share a version flag. PowerShell parses `--version`
        // as a script expression and exits 1 with a ParserError. Use the
        // correct flag per shell, falling back to `--version` for everything else.
        let version_args: &[&str] = match profile.executable.as_str() {
            "powershell" | "powershell.exe" => &["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
            "pwsh" | "pwsh.exe" => &["--version"],
            _ => &["--version"],
        };
        let output = hidden_command(&profile.executable)
            .args(version_args)
            .output();
        match output {
            Ok(o) if o.status.success() => Ok(ProfileValidation {
                valid: true,
                version: Some(String::from_utf8_lossy(&o.stdout).trim().to_string()),
                error: None,
            }),
            Ok(o) => Ok(ProfileValidation {
                valid: false,
                version: None,
                error: Some(format!(
                    "{} exited with code {:?}: {}",
                    profile.executable,
                    o.status.code(),
                    String::from_utf8_lossy(&o.stderr).trim()
                )),
            }),
            Err(_) => Ok(ProfileValidation {
                valid: false,
                version: None,
                error: Some(format!("{} was not found on PATH.", profile.executable)),
            }),
        }
    }

    // ─── Defaults ───

    pub fn get_defaults() -> DbResult<RuntimeDefaults> {
        let conn = StorageService::connect()?;
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM app_defaults WHERE key = 'defaults'",
                [],
                |r| r.get(0),
            )
            .ok();
        let mut defaults = match value {
            Some(v) => serde_json::from_str(&v).map_err(|e| e.to_string())?,
            None => RuntimeDefaults::conservative(),
        };
        Self::apply_health_fallback(&mut defaults)?;
        Ok(defaults)
    }

    /// Never surface an unavailable chat adapter as the active default. If the
    /// stored default chat adapter is missing or unavailable, fall back to the
    /// first available chat adapter (preferring the internal native harness).
    /// This does not persist; it corrects the value on read.
    fn apply_health_fallback(defaults: &mut RuntimeDefaults) -> DbResult<()> {
        let profiles = Self::list_profiles()?;
        let chat_profiles: Vec<&RuntimeProfile> = profiles
            .iter()
            .filter(|p| p.kind == RuntimeProfileKind::Chat)
            .collect();
        let current_ok = defaults
            .default_chat_profile_id
            .as_deref()
            .and_then(|id| chat_profiles.iter().find(|p| p.id == id))
            .map(|p| Self::profile_available(p))
            .unwrap_or(false);
        if !current_ok {
            let fallback = chat_profiles
                .iter()
                .find(|p| Self::is_internal_chat_profile(&p.id) && Self::profile_available(p))
                .or_else(|| chat_profiles.iter().find(|p| Self::profile_available(p)));
            defaults.default_chat_profile_id = fallback.map(|p| p.id.clone());
        }
        Ok(())
    }

    pub fn set_defaults(defaults: &RuntimeDefaults) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO app_defaults (key, value) VALUES ('defaults', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![serde_json::to_string(defaults).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn reset_defaults() -> DbResult<()> {
        Self::set_defaults(&RuntimeDefaults::conservative())
    }

    // ─── Permissions ───

    pub fn get_permission_rules() -> DbResult<PermissionRules> {
        let conn = StorageService::connect()?;
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM permission_rules WHERE key = 'rules'",
                [],
                |r| r.get(0),
            )
            .ok();
        match value {
            Some(v) => serde_json::from_str(&v).map_err(|e| e.to_string()),
            None => Ok(PermissionRules::conservative()),
        }
    }

    pub fn set_permission_rules(rules: &PermissionRules) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO permission_rules (key, value) VALUES ('rules', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![serde_json::to_string(rules).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn reset_permission_rules() -> DbResult<()> {
        Self::set_permission_rules(&PermissionRules::conservative())
    }

    // ─── Audit Trail ───

    #[allow(dead_code)]
     pub fn record_audit(
        action: &str,
        scope: Option<&str>,
        decision: &str,
        source_workflow: Option<&str>,
    ) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO audit_trail (id, action, scope, decision, source_workflow, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![gen_id(), action, scope, decision, source_workflow, now()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_audit(limit: u32) -> DbResult<Vec<AuditEntry>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, action, scope, decision, source_workflow, created_at FROM audit_trail ORDER BY created_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(AuditEntry {
                    id: row.get(0)?,
                    action: row.get(1)?,
                    scope: row.get(2)?,
                    decision: row.get(3)?,
                    source_workflow: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn clear_audit() -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute("DELETE FROM audit_trail", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─── Usage Sync ───

    pub fn get_usage_sync_settings() -> DbResult<UsageSyncSettings> {
        let conn = StorageService::connect()?;
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM usage_sync_settings WHERE key = 'settings'",
                [],
                |r| r.get(0),
            )
            .ok();
        match value {
            Some(v) => serde_json::from_str(&v).map_err(|e| e.to_string()),
            None => Ok(UsageSyncSettings {
                auto_sync_usage: false,
                auto_sync_interval_minutes: 60,
                last_usage_sync_at: None,
            }),
        }
    }

    pub fn set_usage_sync_settings(settings: &UsageSyncSettings) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO usage_sync_settings (key, value) VALUES ('settings', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![serde_json::to_string(settings).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileValidation {
    pub valid: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}
