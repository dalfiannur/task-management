//! Notification rows ↔ proto, plus the reads and writes the notification flows
//! make (all scoped to a recipient).
//!
//! Plain sqlx over the component tables of `persistence/src/schema.sql` (see
//! `persistence::entity`). A notification is one entity carrying
//! `cmp_notificationinfo`, optionally `cmp_notificationrefs`.

use domain::notification::NotificationType;
use persistence::{entity, Store};
use sqlx::postgres::PgRow;
use sqlx::Row;

use crate::sedjiwa::tasks::notification::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct NotificationRecord {
    pub pid: i64,
    pub recipient_id: String,
    pub kind: NotificationType,
    pub actor_id: String,
    pub message: String,
    pub read: bool,
    pub created_at: String,
    pub project_id: Option<String>,
    pub task_id: Option<String>,
    pub comment_id: Option<String>,
}

const SELECT_NOTIFICATION: &str = "\
    SELECT i.pid, i.recipient_id, i.kind, i.actor_id, i.message, i.read, i.created_at, \
           r.project_id, r.task_id, r.comment_id \
    FROM cmp_notificationinfo i LEFT JOIN cmp_notificationrefs r ON r.pid = i.pid";

/// `None` for a stored kind this build does not know.
fn read_notification(row: &PgRow) -> sqlx::Result<Option<NotificationRecord>> {
    let kind: String = row.try_get("kind")?;
    let Some(kind) = NotificationType::parse(&kind) else {
        return Ok(None);
    };
    Ok(Some(NotificationRecord {
        pid: row.try_get("pid")?,
        recipient_id: row.try_get("recipient_id")?,
        kind,
        actor_id: row.try_get("actor_id")?,
        message: row.try_get("message")?,
        read: row.try_get("read")?,
        created_at: row.try_get("created_at")?,
        project_id: row.try_get("project_id")?,
        task_id: row.try_get("task_id")?,
        comment_id: row.try_get("comment_id")?,
    }))
}

pub(crate) fn to_proto(n: &NotificationRecord) -> pb::Notification {
    pb::Notification {
        id: n.pid.to_string(),
        r#type: n.kind.to_proto(),
        actor_id: n.actor_id.clone(),
        message: n.message.clone(),
        read: n.read,
        created_at: n.created_at.clone(),
        project_id: n.project_id.clone(),
        task_id: n.task_id.clone(),
        comment_id: n.comment_id.clone(),
    }
}

pub(crate) async fn load_notification(
    store: &Store,
    pid: i64,
) -> anyhow::Result<Option<NotificationRecord>> {
    let row = sqlx::query(&format!("{SELECT_NOTIFICATION} WHERE i.pid = $1"))
        .bind(pid)
        .fetch_optional(store.pool())
        .await?;
    Ok(match row {
        Some(row) => read_notification(&row)?,
        None => None,
    })
}

/// A recipient's notifications, newest first (created_at desc byte-wise, then
/// pid desc).
pub(crate) async fn notifications_for_recipient(
    store: &Store,
    recipient_id: &str,
) -> anyhow::Result<Vec<NotificationRecord>> {
    let rows = sqlx::query(&format!(
        "{SELECT_NOTIFICATION} WHERE i.recipient_id = $1 \
         ORDER BY i.created_at COLLATE \"C\" DESC, i.pid DESC"
    ))
    .bind(recipient_id)
    .fetch_all(store.pool())
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.extend(read_notification(row)?);
    }
    Ok(out)
}

pub(crate) struct NewNotification<'a> {
    pub recipient_id: &'a str,
    pub kind: NotificationType,
    pub actor_id: &'a str,
    pub message: &'a str,
    pub created_at: &'a str,
    pub project_id: Option<String>,
    pub task_id: Option<String>,
    pub comment_id: Option<String>,
}

/// An unread notification with its refs row. Returns its `pid`.
pub(crate) async fn create_notification(
    store: &Store,
    n: NewNotification<'_>,
) -> anyhow::Result<i64> {
    let mut tx = store.pool().begin().await?;
    let pid = entity::new_pid(&mut tx).await?;
    sqlx::query(
        "INSERT INTO cmp_notificationinfo (pid, recipient_id, kind, actor_id, message, read, created_at) \
         VALUES ($1, $2, $3, $4, $5, false, $6)",
    )
    .bind(pid)
    .bind(n.recipient_id)
    .bind(n.kind.as_str())
    .bind(n.actor_id)
    .bind(n.message)
    .bind(n.created_at)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO cmp_notificationrefs (pid, project_id, task_id, comment_id) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(pid)
    .bind(n.project_id)
    .bind(n.task_id)
    .bind(n.comment_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(pid)
}

pub(crate) async fn mark_read(store: &Store, pid: i64) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if entity::touch(&mut tx, pid).await? {
        sqlx::query("UPDATE cmp_notificationinfo SET read = true WHERE pid = $1")
            .bind(pid)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
    }
    Ok(())
}
