//! Comments: flat task comments (`CommentService`). Project derived from the
//! task. See docs/…/comments-flow-design.md.
//! Deferred: mention→notification emit (Notifications flow not built — no-op).

mod comment_service;
pub(crate) mod record;

pub use comment_service::comment_router;

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::ConnectError;
use persistence::Store;

use crate::projects::record::{is_member, load_project};
use record::CommentRecord;

pub(crate) type StoreExt = Extension<Arc<Store>>;

pub(crate) fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

pub(crate) fn parse_pid(id: &str) -> Result<i64, ConnectError> {
    id.parse::<i64>()
        .map_err(|_| ConnectError::new_not_found("comment not found"))
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

/// Only the comment's author may edit it.
pub(crate) fn require_author(
    comment: &CommentRecord,
    auth: &AuthUser,
) -> Result<(), ConnectError> {
    if comment.author_id == auth.id {
        Ok(())
    } else {
        Err(ConnectError::new_permission_denied("only the author may edit"))
    }
}

/// Delete moderation: author, project owner, or admin.
pub(crate) async fn require_author_owner_or_admin(
    store: &Store,
    comment: &CommentRecord,
    project_id: &str,
    auth: &AuthUser,
) -> Result<(), ConnectError> {
    if auth.is_admin() || comment.author_id == auth.id {
        return Ok(());
    }
    if let Ok(pid) = project_id.parse::<i64>() {
        if let Some(p) = load_project(store, pid).await.map_err(internal)? {
            if p.owner_id == auth.id {
                return Ok(());
            }
        }
    }
    Err(ConnectError::new_permission_denied(
        "author, project owner, or admin required",
    ))
}
