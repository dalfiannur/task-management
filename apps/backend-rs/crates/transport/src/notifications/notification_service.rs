//! NotificationService: list/unread/mark-read (unary) + stream (server-streaming).
//! All scoped to the caller (recipient).

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse, StreamBody};
use domain::notification::NotificationInfo;
use persistence::Store;
use tokio_stream::wrappers::UnboundedReceiverStream;

use super::record::{load_notification, notifications_for_recipient, to_proto};
use super::{internal, require_auth, NotifierExt, StoreExt};
use crate::sedjiwa::tasks::notification::v1 as pb;
use crate::sedjiwa::tasks::notification::v1::notification_service_connect::NotificationServiceBuilder;

const DEFAULT_PAGE_SIZE: u32 = 20;

type NotifStream = UnboundedReceiverStream<Result<pb::Notification, ConnectError>>;

/// Set a notification's `read` flag if it belongs to the caller and isn't already
/// read. Ignores non-owned ids silently.
async fn mark_one(store: &Store, pid: i64, recipient: &str) -> Result<(), ConnectError> {
    let Some(n) = load_notification(store, pid).await.map_err(internal)? else {
        return Ok(());
    };
    if n.recipient_id != recipient || n.read {
        return Ok(());
    }
    store
        .update(pid, move |w, e| {
            if let Some(info) = w.get::<NotificationInfo>(e).cloned() {
                w.remove::<NotificationInfo>(e);
                w.insert(e, NotificationInfo { read: true, ..info });
            }
        })
        .await
        .map_err(internal)
}

async fn list_notifications(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListNotificationsRequest>,
) -> Result<ConnectResponse<pb::ListNotificationsResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let all = notifications_for_recipient(&store, &auth.id)
        .await
        .map_err(internal)?;
    let total = all.len() as u32;
    let page = r.page.max(1);
    let page_size = if r.page_size == 0 {
        DEFAULT_PAGE_SIZE
    } else {
        r.page_size
    };
    let start = ((page - 1) as usize).saturating_mul(page_size as usize);
    let notifications = all
        .into_iter()
        .skip(start)
        .take(page_size as usize)
        .map(|n| to_proto(&n))
        .collect();
    Ok(ConnectResponse::new(pb::ListNotificationsResponse {
        notifications,
        total,
    }))
}

async fn unread_count(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    _req: ConnectRequest<pb::UnreadCountRequest>,
) -> Result<ConnectResponse<pb::UnreadCountResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let count = notifications_for_recipient(&store, &auth.id)
        .await
        .map_err(internal)?
        .iter()
        .filter(|n| !n.read)
        .count() as u32;
    Ok(ConnectResponse::new(pb::UnreadCountResponse { count }))
}

async fn mark_read(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::MarkReadRequest>,
) -> Result<ConnectResponse<pb::OkResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    for id in r.ids {
        if let Ok(pid) = id.parse::<i64>() {
            mark_one(&store, pid, &auth.id).await?;
        }
    }
    Ok(ConnectResponse::new(pb::OkResponse { ok: true }))
}

async fn mark_all_read(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    _req: ConnectRequest<pb::MarkAllReadRequest>,
) -> Result<ConnectResponse<pb::OkResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let unread: Vec<i64> = notifications_for_recipient(&store, &auth.id)
        .await
        .map_err(internal)?
        .into_iter()
        .filter(|n| !n.read)
        .map(|n| n.pid)
        .collect();
    for pid in unread {
        mark_one(&store, pid, &auth.id).await?;
    }
    Ok(ConnectResponse::new(pb::OkResponse { ok: true }))
}

/// Server-streaming: register a live channel; new emits to this recipient are
/// pushed until the client disconnects.
async fn stream_notifications(
    Extension(notifier): NotifierExt,
    user: Option<Extension<AuthUser>>,
    _req: ConnectRequest<pb::StreamNotificationsRequest>,
) -> Result<ConnectResponse<StreamBody<NotifStream>>, ConnectError> {
    let auth = require_auth(user)?;
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    notifier.register(auth.id, tx);
    Ok(ConnectResponse::new(StreamBody::new(
        UnboundedReceiverStream::new(rx),
    )))
}

/// NotificationService router; injects the Store + Notifier as request extensions.
pub fn notification_router(store: Arc<Store>, notifier: Arc<super::Notifier>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    NotificationServiceBuilder::<()>::new()
        .list_notifications::<_, (StoreExt, A, ConnectRequest<pb::ListNotificationsRequest>)>(
            list_notifications,
        )
        .unread_count::<_, (StoreExt, A, ConnectRequest<pb::UnreadCountRequest>)>(unread_count)
        .mark_read::<_, (StoreExt, A, ConnectRequest<pb::MarkReadRequest>)>(mark_read)
        .mark_all_read::<_, (StoreExt, A, ConnectRequest<pb::MarkAllReadRequest>)>(mark_all_read)
        .stream_notifications::<_, (
            NotifierExt,
            A,
            ConnectRequest<pb::StreamNotificationsRequest>,
            StreamBody<NotifStream>,
        )>(stream_notifications)
        .build()
        .layer(Extension(store))
        .layer(Extension(notifier))
}
