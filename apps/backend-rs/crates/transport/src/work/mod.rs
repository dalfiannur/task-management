//! Work: Modules & Tasks (all-tasks tab). Two services on the per-op Store; the
//! owning project is derived from the module (task → module → project) for
//! membership/ownership guards. See docs/…/project-all-tasks-tab-flow-design.md.
//!
//! Deferred (systems not built yet): activity + notification emits (spec §4.7).

mod module_service;
mod record;
mod task_record;
mod task_service;

pub use module_service::module_router;
pub use task_service::task_router;

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::ConnectError;
use persistence::Store;

use crate::projects::record::{is_member, load_project};

pub(crate) fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

/// Parse a user-supplied id into a `pid`, or `not_found`.
pub(crate) fn parse_pid(id: &str) -> Result<i64, ConnectError> {
    id.parse::<i64>()
        .map_err(|_| ConnectError::new_not_found("not found"))
}

pub(crate) fn require_auth(user: Option<Extension<AuthUser>>) -> Result<AuthUser, ConnectError> {
    user.map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))
}

/// Caller must be a member of `project_id` (admin bypasses).
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

/// Caller must be the project owner or an admin.
pub(crate) async fn require_owner_or_admin(
    store: &Store,
    project_id: &str,
    auth: &AuthUser,
) -> Result<(), ConnectError> {
    if auth.is_admin() {
        return Ok(());
    }
    let pid = project_id
        .parse::<i64>()
        .map_err(|_| ConnectError::new_not_found("project not found"))?;
    let p = load_project(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("project not found"))?;
    if p.owner_id == auth.id {
        Ok(())
    } else {
        Err(ConnectError::new_permission_denied("owner or admin required"))
    }
}

/// Store injected into both work routers (kept here so `Arc` is imported once).
pub(crate) type StoreExt = Extension<Arc<Store>>;

/// Resolve a task's owning project (task → module → project), or `None` if the
/// task/module is missing or the id is malformed. Used cross-module (e.g. media
/// link validation).
pub(crate) async fn task_project_id(
    store: &Store,
    task_id: &str,
) -> anyhow::Result<Option<String>> {
    let Ok(tpid) = task_id.parse::<i64>() else {
        return Ok(None);
    };
    let Some(t) = task_record::load_task(store, tpid).await? else {
        return Ok(None);
    };
    let Ok(mpid) = t.module_id.parse::<i64>() else {
        return Ok(None);
    };
    Ok(record::load_module(store, mpid)
        .await?
        .map(|m| m.project_id))
}
