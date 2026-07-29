//! Notification records ↔ proto + store lookups (all scoped to a recipient).

use arke::{Entity, World};
use domain::notification::{NotificationInfo, NotificationRefs, NotificationType};
use persistence::Store;

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

pub(crate) fn read_notification(world: &World, e: Entity, pid: i64) -> Option<NotificationRecord> {
    let info = world.get::<NotificationInfo>(e)?;
    let refs = world.get::<NotificationRefs>(e);
    Some(NotificationRecord {
        pid,
        recipient_id: info.recipient_id.clone(),
        kind: NotificationType::parse(&info.kind)?,
        actor_id: info.actor_id.clone(),
        message: info.message.clone(),
        read: info.read,
        created_at: info.created_at.clone(),
        project_id: refs.and_then(|r| r.project_id.clone()),
        task_id: refs.and_then(|r| r.task_id.clone()),
        comment_id: refs.and_then(|r| r.comment_id.clone()),
    })
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
    let pred = format!("pid = {pid}");
    let mut v = store
        .query::<NotificationInfo, NotificationRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| read_notification(world, *e, *p))
                .collect()
        })
        .await?;
    Ok(v.pop())
}

/// A recipient's notifications, newest first (created_at desc, then pid desc).
pub(crate) async fn notifications_for_recipient(
    store: &Store,
    recipient_id: &str,
) -> anyhow::Result<Vec<NotificationRecord>> {
    let r = recipient_id.to_string();
    let mut v = store
        .query::<NotificationInfo, NotificationRecord>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_notification(world, *e, *pid))
                .filter(|n| n.recipient_id == r)
                .collect()
        })
        .await?;
    v.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.pid.cmp(&a.pid)));
    Ok(v)
}
