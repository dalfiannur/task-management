//! Labels: per-project palette (`LabelService`). All ops member-gated.
//! See docs/…/labels-palette-flow-design.md.

mod label_service;
mod record;

pub use label_service::label_router;

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

pub(crate) fn parse_pid(id: &str) -> Result<i64, ConnectError> {
    id.parse::<i64>()
        .map_err(|_| ConnectError::new_not_found("label not found"))
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
