//! Media: per-project files (presigned S3) + task links (`MediaService`). See
//! docs/…/project-media-tab-flow-design.md. Deferred: activity emit (§5),
//! orphan-Pending GC (§8), size/MIME allow-list (§8.2).

mod media_service;
mod record;

pub use media_service::media_router;

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::ConnectError;
use persistence::Store;
use storage::Storage;

use crate::projects::record::{is_member, load_project};
use record::MediaRecord;

pub(crate) type StoreExt = Extension<Arc<Store>>;
pub(crate) type StorageExt = Extension<Arc<dyn Storage>>;

pub(crate) fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

pub(crate) fn parse_pid(id: &str) -> Result<i64, ConnectError> {
    id.parse::<i64>()
        .map_err(|_| ConnectError::new_not_found("media file not found"))
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

/// Delete is restricted to the uploader, the project owner, or an admin.
pub(crate) async fn require_uploader_owner_or_admin(
    store: &Store,
    media: &MediaRecord,
    auth: &AuthUser,
) -> Result<(), ConnectError> {
    if auth.is_admin() || media.uploaded_by == auth.id {
        return Ok(());
    }
    if let Ok(pid) = media.project_id.parse::<i64>() {
        if let Some(p) = load_project(store, pid).await.map_err(internal)? {
            if p.owner_id == auth.id {
                return Ok(());
            }
        }
    }
    Err(ConnectError::new_permission_denied(
        "only the uploader, project owner, or an admin may delete",
    ))
}
