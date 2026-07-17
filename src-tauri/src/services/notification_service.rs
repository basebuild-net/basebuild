use rusqlite::params;
use tauri::{AppHandle, Emitter, Runtime};

use crate::{
    models::notification::{
        Notification, NotificationDelivery, NotificationKind, NotificationSettings,
    },
    services::storage_service::StorageService,
};

type DbResult<T> = Result<T, String>;

/// Maximum number of read notifications to retain. Older read entries are
/// pruned on insert so the table stays bounded. Unread entries are never pruned.
const MAX_READ_NOTIFICATIONS: i64 = 200;

fn gen_id() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{ts:x}")
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

#[derive(Debug, Default)]
pub struct NotificationService;

impl NotificationService {
    /// Insert a notification from a planning event. The `delivery` setting
    /// is resolved by the caller (or defaults) and determines whether the
    /// frontend shows a toast. If delivery is `Off`, the notification is not
    /// inserted at all.
    pub fn insert(
        kind: NotificationKind,
        entity_id: &str,
        entity_kind: &str,
        project_path: &str,
        title: &str,
        detail: Option<&str>,
    ) -> DbResult<Notification> {
        let id = gen_id();
        let created_at = now_millis();
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO notifications (id, kind, entity_id, entity_kind, project_path, title, detail, read, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)",
            params![id, kind.as_str(), entity_id, entity_kind, project_path, title, detail, created_at],
        )
        .map_err(|e| e.to_string())?;

        // Prune oldest read entries beyond the cap.
        Self::prune_read(&conn)?;

        Self::get(&id)?.ok_or_else(|| "Notification not found after insert".to_string())
    }

    /// Insert a notification only if the delivery setting allows it.
    /// Returns the inserted notification, or None if delivery is `Off`.
    pub fn insert_if_delivered(
        settings: &NotificationSettings,
        kind: NotificationKind,
        entity_id: &str,
        entity_kind: &str,
        project_path: &str,
        title: &str,
        detail: Option<&str>,
    ) -> DbResult<Option<Notification>> {
        let delivery = settings.effective(kind);
        if delivery == NotificationDelivery::Off {
            return Ok(None);
        }
        Self::insert(kind, entity_id, entity_kind, project_path, title, detail).map(Some)
    }

    /// Persist and broadcast a notification using the user's delivery
    /// preference. `toast_and_center` also emits an attention event; the
    /// frontend owns sound and platform window-attention behavior.
    pub fn deliver<R: Runtime>(
        app: &AppHandle<R>,
        kind: NotificationKind,
        entity_id: &str,
        entity_kind: &str,
        project_path: &str,
        title: &str,
        detail: Option<&str>,
    ) -> DbResult<Option<Notification>> {
        let settings = Self::get_settings()?;
        let delivery = settings.effective(kind);
        let notification = Self::insert_if_delivered(
            &settings,
            kind,
            entity_id,
            entity_kind,
            project_path,
            title,
            detail,
        )?;
        if let Some(notification) = &notification {
            let _ = app.emit("notifications://changed", ());
            if delivery == NotificationDelivery::ToastAndCenter {
                let _ = app.emit("notifications://attention", notification.clone());
            }
        }
        Ok(notification)
    }

    pub fn list(limit: i64, offset: i64) -> DbResult<Vec<Notification>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, kind, entity_id, entity_kind, project_path, title, detail, read, created_at
                 FROM notifications ORDER BY created_at DESC LIMIT ?1 OFFSET ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit, offset], Self::row_to_notification)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn list_unread() -> DbResult<Vec<Notification>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, kind, entity_id, entity_kind, project_path, title, detail, read, created_at
                 FROM notifications WHERE read = 0 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], Self::row_to_notification)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn unread_count() -> DbResult<i64> {
        let conn = StorageService::connect()?;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM notifications WHERE read = 0",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(count)
    }

    pub fn delete(id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute("DELETE FROM notifications WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get(id: &str) -> DbResult<Option<Notification>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, kind, entity_id, entity_kind, project_path, title, detail, read, created_at
                 FROM notifications WHERE id = ?1 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map(params![id], Self::row_to_notification)
            .map_err(|e| e.to_string())?;
        rows.next().transpose().map_err(|e| e.to_string())
    }

    /// Per-kind delivery settings: stored as JSON in `app_defaults` under the
    /// `notification_settings` key. Absent → all defaults.
    pub fn get_settings() -> DbResult<NotificationSettings> {
        let conn = StorageService::connect()?;
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM app_defaults WHERE key = 'notification_settings'",
                [],
                |r| r.get(0),
            )
            .ok();
        match value {
            Some(v) => serde_json::from_str(&v).map_err(|e| e.to_string()),
            None => Ok(NotificationSettings::default()),
        }
    }

    pub fn mark_read(id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE notifications SET read = 1 WHERE id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        Self::prune_read(&conn)?;
        Ok(())
    }

    pub fn mark_all_read() -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute("UPDATE notifications SET read = 1 WHERE read = 0", [])
            .map_err(|e| e.to_string())?;
        Self::prune_read(&conn)?;
        Ok(())
    }

    pub fn set_settings(settings: &NotificationSettings) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO app_defaults (key, value) VALUES ('notification_settings', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![serde_json::to_string(settings).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Prune oldest read entries beyond `MAX_READ_NOTIFICATIONS`. Unread
    /// entries are never pruned.
    fn prune_read(conn: &rusqlite::Connection) -> DbResult<()> {
        conn.execute(
            "DELETE FROM notifications WHERE read = 1 AND id NOT IN (
                SELECT id FROM notifications WHERE read = 1
                ORDER BY created_at DESC LIMIT ?1
            )",
            params![MAX_READ_NOTIFICATIONS],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn row_to_notification(row: &rusqlite::Row<'_>) -> rusqlite::Result<Notification> {
        let kind_str: String = row.get(1)?;
        let kind = NotificationKind::from_str(&kind_str).unwrap_or(NotificationKind::PlanCreated);
        let detail: Option<String> = row.get(6)?;
        let read_int: i64 = row.get(7)?;
        Ok(Notification {
            id: row.get(0)?,
            kind,
            entity_id: row.get(2)?,
            entity_kind: row.get(3)?,
            project_path: row.get(4)?,
            title: row.get(5)?,
            detail,
            read: read_int != 0,
            created_at: row.get(8)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_and_list_unread() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let n = NotificationService::insert(
            NotificationKind::RunFinished,
            "run_1",
            "plan_run",
            "/repo",
            "Run finished",
            Some("All tasks complete"),
        )
        .unwrap();
        assert!(!n.read);
        let unread = NotificationService::list_unread().unwrap();
        assert_eq!(unread.len(), 1);
        assert_eq!(unread[0].id, n.id);
        assert_eq!(unread[0].kind, NotificationKind::RunFinished);
    }

    #[test]
    fn mark_read_clears_unread() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let n = NotificationService::insert(
            NotificationKind::PlanCreated,
            "plan_1",
            "plan",
            "/repo",
            "Plan created",
            None,
        )
        .unwrap();
        assert_eq!(NotificationService::unread_count().unwrap(), 1);
        NotificationService::mark_read(&n.id).unwrap();
        assert_eq!(NotificationService::unread_count().unwrap(), 0);
    }

    #[test]
    fn insert_if_delivered_respects_off() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let mut settings = NotificationSettings::default();
        settings
            .overrides
            .insert("run_finished".to_string(), "off".to_string());
        let result = NotificationService::insert_if_delivered(
            &settings,
            NotificationKind::RunFinished,
            "run_1",
            "plan_run",
            "/repo",
            "Run finished",
            None,
        )
        .unwrap();
        assert!(result.is_none());
        assert_eq!(NotificationService::unread_count().unwrap(), 0);
    }

    #[test]
    fn prune_read_bounds_table() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        // Insert MAX_READ + 50 read notifications.
        for i in 0..(MAX_READ_NOTIFICATIONS + 50) {
            let n = NotificationService::insert(
                NotificationKind::IdeaCaptured,
                &format!("idea_{i}"),
                "idea",
                "/repo",
                &format!("Idea {i}"),
                None,
            )
            .unwrap();
            NotificationService::mark_read(&n.id).unwrap();
        }
        // Count total read rows — should be capped at MAX_READ.
        let conn = StorageService::connect().unwrap();
        let total_read: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM notifications WHERE read = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(total_read, MAX_READ_NOTIFICATIONS);
    }
}
