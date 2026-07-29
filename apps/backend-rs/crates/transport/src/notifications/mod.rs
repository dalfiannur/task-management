//! Notifications: in-app + real-time (`NotificationService`), plus the shared
//! `emit` helper other services call. See docs/…/notifications-flow-design.md.
//! Single-instance in-memory streaming; multi-instance fan-out deferred (§6).

mod notification_service;
mod notifier;
mod record;

pub use notification_service::notification_router;
pub use notifier::Notifier;
pub(crate) use notifier::{emit, NotifRefs};

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::ConnectError;
use persistence::Store;

pub(crate) type StoreExt = Extension<Arc<Store>>;
pub(crate) type NotifierExt = Extension<Arc<Notifier>>;

pub(crate) fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

pub(crate) fn require_auth(user: Option<Extension<AuthUser>>) -> Result<AuthUser, ConnectError> {
    user.map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))
}
