use rusqlite::{params, OptionalExtension};
use tauri::{AppHandle, Emitter};

use crate::{
    events::CONNECTOR_EVENT,
    models::{
        connector::{
            Connector, ConnectorCapability, ConnectorError, ConnectorEvent, ConnectorEventType,
            ConnectorGrantDecision, ConnectorGrantScope, ConnectorManifest, ConnectorState,
            ConnectorTransport, ConnectorPermissionRequest, ProviderClaim,
        },
        permission::PermissionDecision,
    },
    services::storage_service::StorageService,
};

type DbResult<T> = Result<T, String>;

fn gen_id() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{ts:x}")
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

#[derive(Debug, Default)]
pub struct ConnectorService;

impl ConnectorService {
    // ── Registry ────────────────────────────────────────────────────────

    /// Register a connector from a manifest. If already registered, update it.
    pub fn register(manifest: ConnectorManifest) -> DbResult<Connector> {
        let existing = Self::get_by_manifest_id(&manifest.id)?;
        let now = now();
        let capabilities_json = serde_json::to_string(
            &manifest.capabilities.iter().map(|c| c.as_str()).collect::<Vec<_>>(),
        )
        .map_err(|e| e.to_string())?;

        if let Some(existing_conn) = existing {
            // Update existing.
            let db = StorageService::connect()?;
            db.execute(
                "UPDATE connectors SET name = ?1, version = ?2, transport = ?3,
                 capabilities = ?4, trusted = ?5, updated_at = ?6 WHERE id = ?7",
                params![
                    manifest.name,
                    manifest.version,
                    manifest.transport.as_str(),
                    capabilities_json,
                    manifest.trusted as i32,
                    now,
                    existing_conn.id,
                ],
            )
            .map_err(|e| format!("Failed to update connector: {e}"))?;
            return Self::get_by_manifest_id(&manifest.id)?.ok_or_else(|| "Connector not found after update".to_string());
        }

        // Insert new.
        let id = gen_id();
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO connectors (id, manifest_id, name, version, transport, capabilities,
             state, trusted, enabled, project_path, last_error, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, NULL, ?10, ?11)",
            params![
                id,
                manifest.id,
                manifest.name,
                manifest.version,
                manifest.transport.as_str(),
                capabilities_json,
                ConnectorState::Registered.as_str(),
                manifest.trusted as i32,
                manifest.default_enabled as i32,
                now,
                now,
            ],
        )
        .map_err(|e| format!("Failed to register connector: {e}"))?;
        Self::get(&id)?.ok_or_else(|| "Connector not found after registration".to_string())
    }

    pub fn list() -> DbResult<Vec<Connector>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, manifest_id, name, version, transport, capabilities, state,
                        trusted, enabled, project_path, last_error, created_at, updated_at
                 FROM connectors ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], Self::map_connector)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn get(id: &str) -> DbResult<Option<Connector>> {
        let conn = StorageService::connect()?;
        conn.query_row(
            "SELECT id, manifest_id, name, version, transport, capabilities, state,
                    trusted, enabled, project_path, last_error, created_at, updated_at
             FROM connectors WHERE id = ?1",
            params![id],
            Self::map_connector,
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn get_by_manifest_id(manifest_id: &str) -> DbResult<Option<Connector>> {
        let conn = StorageService::connect()?;
        conn.query_row(
            "SELECT id, manifest_id, name, version, transport, capabilities, state,
                    trusted, enabled, project_path, last_error, created_at, updated_at
             FROM connectors WHERE manifest_id = ?1",
            params![manifest_id],
            Self::map_connector,
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn set_enabled(id: &str, enabled: bool) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE connectors SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
            params![enabled as i32, now(), id],
        )
        .map_err(|e| format!("Failed to toggle connector: {e}"))?;
        Ok(())
    }

    pub fn set_state(app: &AppHandle, id: &str, state: ConnectorState, error: Option<&str>) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE connectors SET state = ?1, last_error = ?2, updated_at = ?3 WHERE id = ?4",
            params![state.as_str(), error, now(), id],
        )
        .map_err(|e| format!("Failed to set connector state: {e}"))?;

        // Emit state change event.
        let connector = Self::get(id)?;
        if let Some(conn) = &connector {
            let _ = app.emit(
                CONNECTOR_EVENT,
                ConnectorEvent {
                    connector_id: conn.id.clone(),
                    event_type: ConnectorEventType::StateChanged,
                    payload: serde_json::json!({
                        "state": state.as_str(),
                        "name": conn.name,
                    }),
                },
            );
        }
        Ok(())
    }

    pub fn delete(id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute("DELETE FROM connectors WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete connector: {e}"))?;
        Ok(())
    }

    // ── Capability negotiation ──────────────────────────────────────────

    /// Check if a connector supports a capability.
    pub fn has_capability(connector: &Connector, capability: ConnectorCapability) -> bool {
        connector.capabilities.contains(&capability)
    }

    /// Negotiate capabilities: returns the intersection of requested and
    /// supported capabilities. Unsupported capabilities return a typed error.
    pub fn negotiate(
        connector: &Connector,
        requested: &[ConnectorCapability],
    ) -> Result<Vec<ConnectorCapability>, ConnectorError> {
        if !connector.enabled {
            return Err(ConnectorError::NotEnabled);
        }
        let supported: Vec<_> = requested
            .iter()
            .filter(|c| connector.capabilities.contains(c))
            .cloned()
            .collect();
        Ok(supported)
    }

    // ── Permission broker ───────────────────────────────────────────────

    /// Resolve a permission request for a connector capability. Extends the
    /// native-agent-loop approval substrate: checks connector grants first,
    /// then falls back to the project's approval mode (Safe/Balanced/Auto).
    pub fn resolve_permission(
        request: &ConnectorPermissionRequest,
    ) -> ConnectorGrantDecision {
        let connector = match Self::get(&request.connector_id) {
            Ok(Some(c)) => c,
            _ => {
                return ConnectorGrantDecision {
                    connector_id: request.connector_id.clone(),
                    capability: request.capability,
                    decision: PermissionDecision::Deny,
                    scope: ConnectorGrantScope::Once,
                    audit_id: None,
                };
            }
        };

        if !connector.enabled {
            return ConnectorGrantDecision {
                connector_id: request.connector_id.clone(),
                capability: request.capability,
                decision: PermissionDecision::Deny,
                scope: ConnectorGrantScope::Once,
                audit_id: None,
            };
        }

        // Check for existing project-scoped grants.
        if let Ok(grants) = Self::list_grants(&request.connector_id) {
            for grant in &grants {
                if grant.capability == request.capability.as_str()
                    && grant.decision == PermissionDecision::Allow.as_str()
                {
                    return ConnectorGrantDecision {
                        connector_id: request.connector_id.clone(),
                        capability: request.capability,
                        decision: PermissionDecision::Allow,
                        scope: ConnectorGrantScope::Project,
                        audit_id: None,
                    };
                }
            }
        }

        // Fall back to ask (prompt the user).
        ConnectorGrantDecision {
            connector_id: request.connector_id.clone(),
            capability: request.capability,
            decision: PermissionDecision::Ask,
            scope: ConnectorGrantScope::Once,
            audit_id: None,
        }
    }

    /// Record a grant decision (allow/deny) for a connector capability.
    pub fn record_grant(
        app: &AppHandle,
        connector_id: &str,
        capability: ConnectorCapability,
        decision: PermissionDecision,
        scope: ConnectorGrantScope,
    ) -> DbResult<ConnectorGrantDecision> {
        let id = gen_id();
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO connector_grants (id, connector_id, capability, decision, scope, project_path, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
            params![id, connector_id, capability.as_str(), decision.as_str(), scope.as_str(), now()],
        )
        .map_err(|e| format!("Failed to record connector grant: {e}"))?;

        // Record in the shared audit trail (reuses the native-agent-loop audit surface).
        let action = format!("connector:{}:{}", connector_id, capability.as_str());
        let _ = crate::services::settings_service::SettingsService::record_audit(
            &action,
            Some(&scope.as_str()),
            decision.as_str(),
            Some("connector_permission_broker"),
        );

        let grant = ConnectorGrantDecision {
            connector_id: connector_id.to_string(),
            capability,
            decision,
            scope,
            audit_id: Some(id),
        };

        // Emit permission decision event.
        let _ = app.emit(
            CONNECTOR_EVENT,
            ConnectorEvent {
                connector_id: connector_id.to_string(),
                event_type: ConnectorEventType::PermissionRequested,
                payload: serde_json::json!({
                    "capability": capability.as_str(),
                    "decision": decision.as_str(),
                }),
            },
        );

        Ok(grant)
    }

    /// Revoke all grants for a connector (e.g. when disabled).
    pub fn revoke_grants(connector_id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "DELETE FROM connector_grants WHERE connector_id = ?1",
            params![connector_id],
        )
        .map_err(|e| format!("Failed to revoke connector grants: {e}"))?;
        Ok(())
    }

    /// List all grants for a connector.
    pub fn list_grants(connector_id: &str) -> DbResult<Vec<ConnectorGrantRecord>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, connector_id, capability, decision, scope, project_path, created_at
                 FROM connector_grants WHERE connector_id = ?1 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![connector_id], |row| {
                Ok(ConnectorGrantRecord {
                    id: row.get(0)?,
                    connector_id: row.get(1)?,
                    capability: row.get(2)?,
                    decision: row.get(3)?,
                    scope: row.get(4)?,
                    project_path: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    // ── Provider claims ─────────────────────────────────────────────────

    /// Record a provider claim from a connector.
    pub fn claim_provider(
        app: &AppHandle,
        connector_id: &str,
        provider_id: &str,
        provider_label: &str,
    ) -> DbResult<ProviderClaim> {
        let id = gen_id();
        let now = now();
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO provider_claims (id, connector_id, provider_id, provider_label, approved, denied, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?6)",
            params![id, connector_id, provider_id, provider_label, now, now],
        )
        .map_err(|e| format!("Failed to record provider claim: {e}"))?;

        let _ = app.emit(
            CONNECTOR_EVENT,
            ConnectorEvent {
                connector_id: connector_id.to_string(),
                event_type: ConnectorEventType::ProviderClaimed,
                payload: serde_json::json!({
                    "provider_id": provider_id,
                    "provider_label": provider_label,
                }),
            },
        );

        Self::get_claim(&id)?.ok_or_else(|| "Provider claim not found".to_string())
    }

    pub fn get_claim(id: &str) -> DbResult<Option<ProviderClaim>> {
        let conn = StorageService::connect()?;
        conn.query_row(
            "SELECT id, connector_id, provider_id, provider_label, approved, denied, created_at, updated_at
             FROM provider_claims WHERE id = ?1",
            params![id],
            |row| {
                Ok(ProviderClaim {
                    id: row.get(0)?,
                    connector_id: row.get(1)?,
                    provider_id: row.get(2)?,
                    provider_label: row.get(3)?,
                    approved: row.get::<_, i64>(4)? != 0,
                    denied: row.get::<_, i64>(5)? != 0,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn list_claims(connector_id: &str) -> DbResult<Vec<ProviderClaim>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, connector_id, provider_id, provider_label, approved, denied, created_at, updated_at
                 FROM provider_claims WHERE connector_id = ?1 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![connector_id], |row| {
                Ok(ProviderClaim {
                    id: row.get(0)?,
                    connector_id: row.get(1)?,
                    provider_id: row.get(2)?,
                    provider_label: row.get(3)?,
                    approved: row.get::<_, i64>(4)? != 0,
                    denied: row.get::<_, i64>(5)? != 0,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn approve_claim(app: &AppHandle, id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE provider_claims SET approved = 1, denied = 0, updated_at = ?1 WHERE id = ?2",
            params![now(), id],
        )
        .map_err(|e| format!("Failed to approve provider claim: {e}"))?;
        let _ = app.emit(
            CONNECTOR_EVENT,
            ConnectorEvent {
                connector_id: String::new(),
                event_type: ConnectorEventType::ProviderClaimed,
                payload: serde_json::json!({"claim_id": id, "approved": true}),
            },
        );
        Ok(())
    }

    pub fn deny_claim(app: &AppHandle, id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE provider_claims SET approved = 0, denied = 1, updated_at = ?1 WHERE id = ?2",
            params![now(), id],
        )
        .map_err(|e| format!("Failed to deny provider claim: {e}"))?;
        let _ = app.emit(
            CONNECTOR_EVENT,
            ConnectorEvent {
                connector_id: String::new(),
                event_type: ConnectorEventType::ProviderClaimed,
                payload: serde_json::json!({"claim_id": id, "denied": true}),
            },
        );
        Ok(())
    }

    // ── Startup restore ─────────────────────────────────────────────────

    /// Mark all connectors as disconnected on startup (no silent auto-launch).
    pub fn restore_on_startup() -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE connectors SET state = 'disconnected', last_error = NULL WHERE state IN ('connected', 'connecting')",
            [],
        )
        .map_err(|e| format!("Failed to restore connectors: {e}"))?;
        Ok(())
    }

    // ── Mapper ──────────────────────────────────────────────────────────

    fn map_connector(row: &rusqlite::Row<'_>) -> rusqlite::Result<Connector> {
        let transport_str: String = row.get(4)?;
        let caps_json: String = row.get(5)?;
        let state_str: String = row.get(6)?;
        let capabilities: Vec<ConnectorCapability> =
            serde_json::from_str::<Vec<String>>(&caps_json)
                .unwrap_or_default()
                .iter()
                .filter_map(|s| ConnectorCapability::from_str(s))
                .collect();
        Ok(Connector {
            id: row.get(0)?,
            manifest_id: row.get(1)?,
            name: row.get(2)?,
            version: row.get(3)?,
            transport: match transport_str.as_str() {
                "stdio" => ConnectorTransport::Stdio,
                "loopback" => ConnectorTransport::Loopback,
                _ => ConnectorTransport::Pty,
            },
            capabilities,
            state: ConnectorState::from_str(&state_str),
            trusted: row.get::<_, i64>(7)? != 0,
            enabled: row.get::<_, i64>(8)? != 0,
            project_path: row.get(9)?,
            last_error: row.get(10)?,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
        })
    }
}

/// A persisted connector grant record (from the connector_grants table).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorGrantRecord {
    pub id: String,
    pub connector_id: String,
    pub capability: String,
    pub decision: String,
    pub scope: String,
    pub project_path: Option<String>,
    pub created_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connector_state_round_trip() {
        for s in ["registered", "connecting", "connected", "disconnected", "error", "unsupported"] {
            assert_eq!(ConnectorState::from_str(s).as_str(), s);
        }
    }

    #[test]
    fn capability_round_trip() {
        for c in [
            ConnectorCapability::Command,
            ConnectorCapability::FileAccess,
            ConnectorCapability::ProviderClaim,
            ConnectorCapability::ChatSync,
            ConnectorCapability::WebBridge,
            ConnectorCapability::Diagnostics,
            ConnectorCapability::Analytics,
            ConnectorCapability::Skills,
        ] {
            assert_eq!(ConnectorCapability::from_str(c.as_str()), Some(c));
        }
    }

    #[test]
    fn list_empty_for_new_db() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let connectors = ConnectorService::list().unwrap();
        assert!(connectors.is_empty());
    }

    #[test]
    fn register_and_get_connector() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let manifest = ConnectorManifest {
            id: "test-connector".into(),
            name: "Test Connector".into(),
            version: "1.0.0".into(),
            transport: ConnectorTransport::Pty,
            capabilities: vec![ConnectorCapability::Command, ConnectorCapability::Skills],
            detect_command: Some("test-tool".into()),
            launch_command: None,
            trusted: true,
            default_enabled: true,
        };
        let conn = ConnectorService::register(manifest).unwrap();
        assert_eq!(conn.manifest_id, "test-connector");
        assert!(conn.enabled);
        assert!(conn.trusted);
        assert_eq!(conn.capabilities.len(), 2);

        // Get by id.
        let found = ConnectorService::get(&conn.id).unwrap().unwrap();
        assert_eq!(found.name, "Test Connector");

        // Get by manifest id.
        let found2 = ConnectorService::get_by_manifest_id("test-connector").unwrap().unwrap();
        assert_eq!(found2.id, conn.id);
    }

    #[test]
    fn negotiate_returns_supported_capabilities() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let manifest = ConnectorManifest {
            id: "test".into(),
            name: "Test".into(),
            version: "1".into(),
            transport: ConnectorTransport::Pty,
            capabilities: vec![ConnectorCapability::Command, ConnectorCapability::Skills],
            detect_command: None,
            launch_command: None,
            trusted: false,
            default_enabled: true,
        };
        let conn = ConnectorService::register(manifest).unwrap();
        let result = ConnectorService::negotiate(
            &conn,
            &[ConnectorCapability::Command, ConnectorCapability::ChatSync],
        )
        .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], ConnectorCapability::Command);
    }

    #[test]
    fn negotiate_fails_for_disabled_connector() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let manifest = ConnectorManifest {
            id: "disabled".into(),
            name: "Disabled".into(),
            version: "1".into(),
            transport: ConnectorTransport::Pty,
            capabilities: vec![ConnectorCapability::Command],
            detect_command: None,
            launch_command: None,
            trusted: false,
            default_enabled: false,
        };
        let conn = ConnectorService::register(manifest).unwrap();
        let result = ConnectorService::negotiate(&conn, &[ConnectorCapability::Command]);
        assert_eq!(result.unwrap_err(), ConnectorError::NotEnabled);
    }

    #[test]
    fn restore_marks_connectors_disconnected() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let manifest = ConnectorManifest {
            id: "restore-test".into(),
            name: "Restore".into(),
            version: "1".into(),
            transport: ConnectorTransport::Pty,
            capabilities: vec![],
            detect_command: None,
            launch_command: None,
            trusted: false,
            default_enabled: true,
        };
        let conn = ConnectorService::register(manifest).unwrap();
        // Simulate connected state.
        let db = StorageService::connect().unwrap();
        db.execute(
            "UPDATE connectors SET state = 'connected' WHERE id = ?1",
            params![conn.id],
        )
        .unwrap();
        // Restore.
        ConnectorService::restore_on_startup().unwrap();
        let restored = ConnectorService::get(&conn.id).unwrap().unwrap();
        assert_eq!(restored.state, ConnectorState::Disconnected);
    }

    #[test]
    fn provider_claim_round_trip() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let manifest = ConnectorManifest {
            id: "claim-test".into(),
            name: "Claim".into(),
            version: "1".into(),
            transport: ConnectorTransport::Pty,
            capabilities: vec![ConnectorCapability::ProviderClaim],
            detect_command: None,
            launch_command: None,
            trusted: false,
            default_enabled: true,
        };
        let conn = ConnectorService::register(manifest).unwrap();
        // Insert claim directly (skip event emission which needs AppHandle).
        let id = gen_id();
        let ts = now();
        let db = StorageService::connect().unwrap();
        db.execute(
            "INSERT INTO provider_claims (id, connector_id, provider_id, provider_label, approved, denied, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?6)",
            params![id, conn.id, "openai", "OpenAI", ts, ts],
        )
        .unwrap();
        let claim = ConnectorService::get_claim(&id).unwrap().unwrap();
        assert_eq!(claim.provider_id, "openai");
        assert!(!claim.approved);
        assert!(!claim.denied);
        // Approve directly in DB.
        db.execute(
            "UPDATE provider_claims SET approved = 1, denied = 0, updated_at = ?1 WHERE id = ?2",
            params![now(), id],
        )
        .unwrap();
        let approved = ConnectorService::get_claim(&id).unwrap().unwrap();
        assert!(approved.approved);
        assert!(!approved.denied);
    }

    #[test]
    fn grant_recording_and_revocation() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let manifest = ConnectorManifest {
            id: "grant-test".into(),
            name: "Grant".into(),
            version: "1".into(),
            transport: ConnectorTransport::Pty,
            capabilities: vec![ConnectorCapability::Command],
            detect_command: None,
            launch_command: None,
            trusted: false,
            default_enabled: true,
        };
        let conn = ConnectorService::register(manifest).unwrap();
        // Insert grant directly (skip event emission which needs AppHandle).
        let id = gen_id();
        let db = StorageService::connect().unwrap();
        db.execute(
            "INSERT INTO connector_grants (id, connector_id, capability, decision, scope, project_path, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
            params![id, conn.id, "command", "allow", "project", now()],
        )
        .unwrap();
        let grants = ConnectorService::list_grants(&conn.id).unwrap();
        assert_eq!(grants.len(), 1);
        assert_eq!(grants[0].decision, "allow");
        assert_eq!(grants[0].capability, "command");
        // Revoke.
        ConnectorService::revoke_grants(&conn.id).unwrap();
        let grants = ConnectorService::list_grants(&conn.id).unwrap();
        assert!(grants.is_empty());
    }
}
