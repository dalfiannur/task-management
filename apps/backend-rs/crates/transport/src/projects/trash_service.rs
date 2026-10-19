//! ProjectTrashService: list, restore and purge trashed projects, and purge
//! leftovers of projects deleted before the trash existed. Admin only.

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use persistence::Store;
use storage::Storage;

use super::purge::{leftover_project_ids, purge_project};
use super::record::{load_trashed, restore_project, trashed_projects};
use super::{internal, parse_pid};
use crate::search::deindex_project;
use crate::sedjiwa::tasks::trash::v1 as pb;
use crate::sedjiwa::tasks::trash::v1::project_trash_service_connect::ProjectTrashServiceBuilder;

type S = Extension<Arc<Store>>;
type St = Extension<Arc<dyn Storage>>;

fn require_admin(user: Option<Extension<AuthUser>>) -> Result<AuthUser, ConnectError> {
    let auth = user
        .map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))?;
    if auth.is_admin() {
        Ok(auth)
    } else {
        Err(ConnectError::new_permission_denied("admin required"))
    }
}

/// Purge `project_id`'s data, then its stored files and search docs.
async fn purge_all(store: &Store, storage: &dyn Storage, project_id: &str) -> Result<(), ConnectError> {
    let keys = purge_project(store, project_id).await.map_err(internal)?;
    for k in &keys {
        if let Err(e) = storage.delete(k).await {
            tracing::warn!(error = %e, key = %k, "failed to delete a purged media object");
        }
    }
    deindex_project(store, project_id).await;
    Ok(())
}

async fn list_deleted_projects(
    Extension(store): S,
    user: Option<Extension<AuthUser>>,
    _req: ConnectRequest<pb::ListDeletedProjectsRequest>,
) -> Result<ConnectResponse<pb::ListDeletedProjectsResponse>, ConnectError> {
    require_admin(user)?;
    let projects = trashed_projects(&store)
        .await
        .map_err(internal)?
        .into_iter()
        .map(|t| pb::DeletedProject {
            id: t.project.pid.to_string(),
            name: t.project.name,
            owner_id: t.project.owner_id,
            deleted_at: t.deleted_at,
            deleted_by: t.deleted_by,
        })
        .collect();
    let leftover_count = leftover_project_ids(&store).await.map_err(internal)?.len() as i32;
    Ok(ConnectResponse::new(pb::ListDeletedProjectsResponse { projects, leftover_count }))
}

async fn require_trashed(store: &Store, id: &str) -> Result<i64, ConnectError> {
    let pid = parse_pid(id)?;
    load_trashed(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("no such project in the trash"))?;
    Ok(pid)
}

async fn restore(
    Extension(store): S,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::RestoreProjectRequest>,
) -> Result<ConnectResponse<pb::RestoreProjectResponse>, ConnectError> {
    require_admin(user)?;
    let ConnectRequest(r) = req;
    let pid = require_trashed(&store, &r.id).await?;
    restore_project(&store, pid).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::RestoreProjectResponse { ok: true }))
}

async fn purge(
    Extension(store): S,
    Extension(storage): St,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::PurgeProjectRequest>,
) -> Result<ConnectResponse<pb::PurgeProjectResponse>, ConnectError> {
    require_admin(user)?;
    let ConnectRequest(r) = req;
    // Only from the trash: a live project is deleted (trashed) first.
    let pid = require_trashed(&store, &r.id).await?;
    purge_all(&store, storage.as_ref(), &pid.to_string()).await?;
    Ok(ConnectResponse::new(pb::PurgeProjectResponse { ok: true }))
}

async fn purge_leftovers(
    Extension(store): S,
    Extension(storage): St,
    user: Option<Extension<AuthUser>>,
    _req: ConnectRequest<pb::PurgeLeftoversRequest>,
) -> Result<ConnectResponse<pb::PurgeLeftoversResponse>, ConnectError> {
    require_admin(user)?;
    let ids = leftover_project_ids(&store).await.map_err(internal)?;
    for id in &ids {
        purge_all(&store, storage.as_ref(), id).await?;
    }
    Ok(ConnectResponse::new(pb::PurgeLeftoversResponse { projects: ids.len() as i32 }))
}

/// ProjectTrashService router; injects the Store and the media Storage.
pub fn trash_router(store: Arc<Store>, storage: Arc<dyn Storage>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    ProjectTrashServiceBuilder::<()>::new()
        .list_deleted_projects::<_, (S, A, ConnectRequest<pb::ListDeletedProjectsRequest>)>(list_deleted_projects)
        .restore_project::<_, (S, A, ConnectRequest<pb::RestoreProjectRequest>)>(restore)
        .purge_project::<_, (S, St, A, ConnectRequest<pb::PurgeProjectRequest>)>(purge)
        .purge_leftovers::<_, (S, St, A, ConnectRequest<pb::PurgeLeftoversRequest>)>(purge_leftovers)
        .build()
        .layer(Extension(store))
        .layer(Extension(storage))
}
