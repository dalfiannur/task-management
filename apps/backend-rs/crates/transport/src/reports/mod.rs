//! Periodic reports: cross-project aggregation over a caller-supplied window.
//! See docs/superpowers/specs/2026-09-07-periodic-reports-design.md.
//! No new entities; scope is the dashboard's (member projects, admin: all).

mod aggregate;
mod report_service;
pub(crate) mod window;

pub use report_service::report_router;

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::ConnectError;
use persistence::Store;

pub(crate) type StoreExt = Extension<Arc<Store>>;

#[allow(dead_code)]
pub(crate) fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

pub(crate) fn require_auth(user: Option<Extension<AuthUser>>) -> Result<AuthUser, ConnectError> {
    user.map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))
}
