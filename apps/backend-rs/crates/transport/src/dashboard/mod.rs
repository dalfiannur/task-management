//! Dashboard & My-Tasks: cross-project read aggregation over existing Task/
//! Project/Comment data. See docs/…/dashboard-my-tasks-flow-design.md.
//! No new entities; scoped to the caller's member projects (admin: all).

mod context;
mod dashboard_service;
mod mytasks_service;

pub use dashboard_service::dashboard_router;
pub use mytasks_service::mytasks_router;

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::ConnectError;
use persistence::Store;

pub(crate) type StoreExt = Extension<Arc<Store>>;

pub(crate) fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

pub(crate) fn require_auth(user: Option<Extension<AuthUser>>) -> Result<AuthUser, ConnectError> {
    user.map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))
}
