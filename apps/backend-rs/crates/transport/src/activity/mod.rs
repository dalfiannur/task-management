//! Activity: project-wide audit log (`ActivityService`) + the shared `record`
//! helper other services call. See docs/…/activity-feed-flow-design.md.
//! Deferred: retention/cleanup (§7).

mod activity_service;
pub(crate) mod record;
mod recorder;

pub use activity_service::activity_router;
pub(crate) use recorder::record;

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::ConnectError;
use persistence::Store;

use crate::projects::record::is_member;

pub(crate) type StoreExt = Extension<Arc<Store>>;

pub(crate) fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

pub(crate) fn require_auth(user: Option<Extension<AuthUser>>) -> Result<AuthUser, ConnectError> {
    user.map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))
}

pub(crate) async fn require_member(
    store: &Store,
    project_id: &str,
    auth: &AuthUser,
) -> Result<(), ConnectError> {
    if auth.is_admin() {
        return Ok(());
    }
    if is_member(store, project_id, &auth.id)
        .await
        .map_err(internal)?
    {
        Ok(())
    } else {
        Err(ConnectError::new_permission_denied("not a member"))
    }
}
