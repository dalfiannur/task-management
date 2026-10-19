//! ProjectTrashService: list, restore and purge trashed projects, and purge
//! leftovers of projects deleted before the trash existed. Admin only.

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use persistence::Store;
use storage::Storage;

use super::purge::{contents, leftover_project_ids, purge_project, Contents};
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

fn contents_to_proto(c: &Contents) -> pb::ProjectContents {
    pb::ProjectContents {
        tasks: c.tasks as i32,
        modules: c.modules as i32,
        pages: c.pages as i32,
        media_files: c.media_files as i32,
        media_bytes: c.media_bytes,
        time_minutes: c.time_minutes as i32,
        comments: c.comments as i32,
        automations: c.automations as i32,
    }
}

async fn list_deleted_projects(
    Extension(store): S,
    user: Option<Extension<AuthUser>>,
    _req: ConnectRequest<pb::ListDeletedProjectsRequest>,
) -> Result<ConnectResponse<pb::ListDeletedProjectsResponse>, ConnectError> {
    require_admin(user)?;
    let mut projects = Vec::new();
    for t in trashed_projects(&store).await.map_err(internal)? {
        let id = t.project.pid.to_string();
        let c = contents(&store, std::slice::from_ref(&id)).await.map_err(internal)?;
        projects.push(pb::DeletedProject {
            id,
            name: t.project.name,
            owner_id: t.project.owner_id,
            deleted_at: t.deleted_at,
            deleted_by: t.deleted_by,
            contents: Some(contents_to_proto(&c)),
        });
    }
    let leftovers = leftover_project_ids(&store).await.map_err(internal)?;
    let leftover_contents = contents(&store, &leftovers).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::ListDeletedProjectsResponse {
        projects,
        leftover_count: leftovers.len() as i32,
        leftover_contents: Some(contents_to_proto(&leftover_contents)),
    }))
}

async fn require_trashed(store: &Store, id: &str) -> Result<(i64, String), ConnectError> {
    let pid = parse_pid(id)?;
    let p = load_trashed(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("no such project in the trash"))?;
    Ok((pid, p.name))
}

async fn restore(
    Extension(store): S,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::RestoreProjectRequest>,
) -> Result<ConnectResponse<pb::RestoreProjectResponse>, ConnectError> {
    require_admin(user)?;
    let ConnectRequest(r) = req;
    let (pid, _) = require_trashed(&store, &r.id).await?;
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
    let (pid, name) = require_trashed(&store, &r.id).await?;
    if r.confirm_name.trim() != name.trim() {
        return Err(ConnectError::new_failed_precondition(
            "type the project's exact name to delete it for good",
        ));
    }
    purge_all(&store, storage.as_ref(), &pid.to_string()).await?;
    Ok(ConnectResponse::new(pb::PurgeProjectResponse { ok: true }))
}

async fn purge_leftovers(
    Extension(store): S,
    Extension(storage): St,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::PurgeLeftoversRequest>,
) -> Result<ConnectResponse<pb::PurgeLeftoversResponse>, ConnectError> {
    require_admin(user)?;
    let ConnectRequest(r) = req;
    let ids = leftover_project_ids(&store).await.map_err(internal)?;
    if r.confirm_projects as usize != ids.len() {
        return Err(ConnectError::new_failed_precondition(format!(
            "leftovers of {} project{} are waiting now; refresh and confirm again",
            ids.len(),
            if ids.len() == 1 { "" } else { "s" }
        )));
    }
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
