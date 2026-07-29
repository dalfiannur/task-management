//! In-memory real-time registry + the shared `emit` helper other services call.
//! Single-instance (multi-instance fan-out via LISTEN/NOTIFY is deferred, spec §6).

use std::collections::HashMap;
use std::sync::Mutex;

use connectrpc_axum::ConnectError;
use domain::notification::{NotificationInfo, NotificationRefs, NotificationType};
use persistence::Store;
use tokio::sync::mpsc::UnboundedSender;

use super::record::load_notification;
use crate::sedjiwa::tasks::notification::v1 as pb;

/// Item pushed over a `StreamNotifications` channel.
pub(crate) type NotifTx = UnboundedSender<Result<pb::Notification, ConnectError>>;

/// Live stream registry: `recipient_id → open senders`.
#[derive(Default)]
pub struct Notifier {
    streams: Mutex<HashMap<String, Vec<NotifTx>>>,
}

impl Notifier {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a sender for `recipient_id` (called when a stream opens).
    pub(crate) fn register(&self, recipient_id: String, tx: NotifTx) {
        self.streams
            .lock()
            .unwrap()
            .entry(recipient_id)
            .or_default()
            .push(tx);
    }

    /// Push to `recipient_id`'s live streams, pruning any that have closed.
    fn broadcast(&self, recipient_id: &str, msg: &pb::Notification) {
        let mut map = self.streams.lock().unwrap();
        if let Some(senders) = map.get_mut(recipient_id) {
            senders.retain(|tx| tx.send(Ok(msg.clone())).is_ok());
            if senders.is_empty() {
                map.remove(recipient_id);
            }
        }
    }
}

/// Deep-link targets for a notification.
#[derive(Default, Clone)]
pub(crate) struct NotifRefs {
    pub project_id: Option<String>,
    pub task_id: Option<String>,
    pub comment_id: Option<String>,
}

impl NotifRefs {
    pub(crate) fn project(id: &str) -> Self {
        Self {
            project_id: Some(id.to_string()),
            ..Default::default()
        }
    }
    pub(crate) fn task(project_id: &str, task_id: &str) -> Self {
        Self {
            project_id: Some(project_id.to_string()),
            task_id: Some(task_id.to_string()),
            comment_id: None,
        }
    }
    pub(crate) fn comment(project_id: &str, task_id: &str, comment_id: &str) -> Self {
        Self {
            project_id: Some(project_id.to_string()),
            task_id: Some(task_id.to_string()),
            comment_id: Some(comment_id.to_string()),
        }
    }
}

fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

/// Emit a notification: no-op if `recipient == actor`; otherwise persist it
/// (`read=false`) and push to the recipient's live streams. Best-effort — errors
/// are logged, never surfaced to the triggering mutation.
pub(crate) async fn emit(
    store: &Store,
    notifier: &Notifier,
    recipient_id: &str,
    kind: NotificationType,
    actor_id: &str,
    message: String,
    refs: NotifRefs,
) {
    if recipient_id == actor_id || recipient_id.is_empty() {
        return;
    }
    let now = now_iso();
    let created = store
        .create((
            NotificationInfo {
                recipient_id: recipient_id.to_string(),
                kind: kind.as_str().to_string(),
                actor_id: actor_id.to_string(),
                message,
                read: false,
                created_at: now,
            },
            NotificationRefs {
                project_id: refs.project_id,
                task_id: refs.task_id,
                comment_id: refs.comment_id,
            },
        ))
        .await;
    let pid = match created {
        Ok(pid) => pid,
        Err(e) => {
            tracing::warn!(error = %e, "failed to persist notification");
            return;
        }
    };
    if let Ok(Some(rec)) = load_notification(store, pid).await {
        notifier.broadcast(recipient_id, &super::record::to_proto(&rec));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::unbounded_channel;

    #[test]
    fn broadcast_reaches_registered_stream_and_prunes_closed() {
        let n = Notifier::new();
        let (tx, mut rx) = unbounded_channel();
        n.register("u1".into(), tx);
        let msg = pb::Notification {
            id: "1".into(),
            message: "hi".into(),
            ..Default::default()
        };
        n.broadcast("u1", &msg);
        assert_eq!(rx.try_recv().unwrap().unwrap().message, "hi");

        // Different recipient → no delivery.
        n.broadcast("u2", &msg);
        assert!(rx.try_recv().is_err());

        // Closed receiver is pruned on next broadcast.
        drop(rx);
        n.broadcast("u1", &msg);
        assert!(n.streams.lock().unwrap().get("u1").is_none());
    }
}
