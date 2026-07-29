//! ProjectService: create + read (list/get) + owner authority (status/transfer/delete).

use std::collections::HashSet;
use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::project::{
    project_name_ok, ProjectDescription, ProjectMembership, ProjectName, ProjectOwnerId,
    ProjectStatus, ProjectStatusComponent,
};
use persistence::Store;

use super::record::{
    is_member, load_all_projects, load_project, member_project_ids, membership_pids_for_project,
    to_proto, ProjectRecord,
};
use super::{internal, parse_pid};
use crate::sedjiwa::tasks::project::v1 as pb;
use crate::sedjiwa::tasks::project::v1::project_service_connect::ProjectServiceBuilder;

/// Permission required to create a project (every active user's token carries it).
const PERM_CREATE: &str = "projects:create";
const DEFAULT_LIMIT: u32 = 12;

fn require_auth(user: Option<Extension<AuthUser>>) -> Result<AuthUser, ConnectError> {
    user.map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))
}

fn require_owner_or_admin(auth: &AuthUser, project: &ProjectRecord) -> Result<(), ConnectError> {
    if auth.is_admin() || project.owner_id == auth.id {
        Ok(())
    } else {
        Err(ConnectError::new_permission_denied("owner or admin required"))
    }
}

async fn require_project(store: &Store, pid: i64) -> Result<ProjectRecord, ConnectError> {
    load_project(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("project not found"))
}

/// Create a local delivery project: one owner, auto owner membership, status
/// Active. Project and membership rows are separate per-op creates (not atomic).
async fn create_project(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CreateProjectRequest>,
) -> Result<ConnectResponse<pb::Project>, ConnectError> {
    let auth = require_auth(user)?;
    if !auth.has(PERM_CREATE) {
        return Err(ConnectError::new_permission_denied("projects:create required"));
    }
    let ConnectRequest(r) = req;
    let name = r.name.trim();
    if !project_name_ok(name) {
        return Err(ConnectError::new_invalid_argument("name is required"));
    }
    let owner_id = r
        .owner_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| auth.id.clone());

    let pid = store
        .create((
            ProjectName {
                value: name.to_string(),
            },
            ProjectOwnerId {
                value: owner_id.clone(),
            },
            ProjectStatusComponent {
                value: ProjectStatus::Active.as_str().to_string(),
            },
        ))
        .await
        .map_err(internal)?;

    if let Some(desc) = r
        .description
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty())
    {
        store
            .update(pid, move |w, e| {
                w.insert(e, ProjectDescription { value: desc });
            })
            .await
            .map_err(internal)?;
    }

    let project_id = pid.to_string();
    store
        .create((ProjectMembership {
            project_id: project_id.clone(),
            user_id: owner_id.clone(),
        },))
        .await
        .map_err(internal)?;
    if owner_id != auth.id {
        store
            .create((ProjectMembership {
                project_id,
                user_id: auth.id.clone(),
            },))
            .await
            .map_err(internal)?;
    }

    let p = require_project(&store, pid).await?;
    Ok(ConnectResponse::new(to_proto(&p)))
}

/// Member-scoped list (admin sees all) with status/search filters + pagination.
async fn list_projects(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListProjectsRequest>,
) -> Result<ConnectResponse<pb::ListProjectsResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let all = load_all_projects(&store).await.map_err(internal)?;

    // Scope to the caller's memberships (admin: all).
    let visible: Vec<ProjectRecord> = if auth.is_admin() {
        all
    } else {
        let mine: HashSet<String> = member_project_ids(&store, &auth.id)
            .await
            .map_err(internal)?
            .into_iter()
            .collect();
        all.into_iter()
            .filter(|p| mine.contains(&p.pid.to_string()))
            .collect()
    };

    // Status filter (empty / UNSPECIFIED-only → all) + name search.
    let want: Vec<i32> = r.status.into_iter().filter(|c| *c != 0).collect();
    let search = r.search.unwrap_or_default().trim().to_lowercase();
    let mut filtered: Vec<ProjectRecord> = visible
        .into_iter()
        .filter(|p| want.is_empty() || want.contains(&p.status.to_proto()))
        .filter(|p| search.is_empty() || p.name.to_lowercase().contains(&search))
        .collect();
    filtered.sort_by_key(|p| p.pid); // deterministic pagination

    let total = filtered.len() as u32;
    let page = r.page.max(1);
    let limit = if r.limit == 0 { DEFAULT_LIMIT } else { r.limit };
    let start = ((page - 1) as usize).saturating_mul(limit as usize);
    let projects = filtered
        .into_iter()
        .skip(start)
        .take(limit as usize)
        .map(|p| to_proto(&p))
        .collect();
    Ok(ConnectResponse::new(pb::ListProjectsResponse {
        projects,
        total,
    }))
}

/// Member-gated read.
async fn get_project(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetProjectRequest>,
) -> Result<ConnectResponse<pb::Project>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let p = require_project(&store, pid).await?;
    if !auth.is_admin()
        && !is_member(&store, &pid.to_string(), &auth.id)
            .await
            .map_err(internal)?
    {
        return Err(ConnectError::new_permission_denied("not a member"));
    }
    Ok(ConnectResponse::new(to_proto(&p)))
}

/// Owner/admin: change work status.
async fn set_project_status(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::SetProjectStatusRequest>,
) -> Result<ConnectResponse<pb::Project>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let p = require_project(&store, pid).await?;
    require_owner_or_admin(&auth, &p)?;
    let status = ProjectStatus::from_proto(r.status)
        .ok_or_else(|| ConnectError::new_invalid_argument("invalid status"))?;
    store
        .update(pid, move |w, e| {
            w.remove::<ProjectStatusComponent>(e);
            w.insert(
                e,
                ProjectStatusComponent {
                    value: status.as_str().to_string(),
                },
            );
        })
        .await
        .map_err(internal)?;
    let updated = require_project(&store, pid).await?;
    Ok(ConnectResponse::new(to_proto(&updated)))
}

/// Owner/admin: move ownership; the new owner is ensured to be a member.
async fn transfer_project_ownership(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::TransferProjectOwnershipRequest>,
) -> Result<ConnectResponse<pb::Project>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let p = require_project(&store, pid).await?;
    require_owner_or_admin(&auth, &p)?;
    let new_owner = r.new_owner_id.trim().to_string();
    if new_owner.is_empty() {
        return Err(ConnectError::new_invalid_argument("new_owner_id is required"));
    }
    let no = new_owner.clone();
    store
        .update(pid, move |w, e| {
            w.remove::<ProjectOwnerId>(e);
            w.insert(e, ProjectOwnerId { value: no });
        })
        .await
        .map_err(internal)?;
    if !is_member(&store, &pid.to_string(), &new_owner)
        .await
        .map_err(internal)?
    {
        store
            .create((ProjectMembership {
                project_id: pid.to_string(),
                user_id: new_owner,
            },))
            .await
            .map_err(internal)?;
    }
    let updated = require_project(&store, pid).await?;
    Ok(ConnectResponse::new(to_proto(&updated)))
}

/// Owner/admin: delete the project + its membership rows. Module/task cascade is
/// handled by later flows.
async fn delete_project(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::DeleteProjectRequest>,
) -> Result<ConnectResponse<pb::DeleteProjectResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let p = require_project(&store, pid).await?;
    require_owner_or_admin(&auth, &p)?;
    store.delete(pid).await.map_err(internal)?;
    for mpid in membership_pids_for_project(&store, &pid.to_string())
        .await
        .map_err(internal)?
    {
        store.delete(mpid).await.map_err(internal)?;
    }
    Ok(ConnectResponse::new(pb::DeleteProjectResponse { ok: true }))
}

/// ProjectService router; injects the Store as a request extension.
pub fn project_router(store: Arc<Store>) -> axum::Router<()> {
    type S = Extension<Arc<Store>>;
    type A = Option<Extension<AuthUser>>;
    ProjectServiceBuilder::<()>::new()
        .create_project::<_, (S, A, ConnectRequest<pb::CreateProjectRequest>)>(create_project)
        .list_projects::<_, (S, A, ConnectRequest<pb::ListProjectsRequest>)>(list_projects)
        .get_project::<_, (S, A, ConnectRequest<pb::GetProjectRequest>)>(get_project)
        .set_project_status::<_, (S, A, ConnectRequest<pb::SetProjectStatusRequest>)>(
            set_project_status,
        )
        .transfer_project_ownership::<_, (
            S,
            A,
            ConnectRequest<pb::TransferProjectOwnershipRequest>,
        )>(transfer_project_ownership)
        .delete_project::<_, (S, A, ConnectRequest<pb::DeleteProjectRequest>)>(delete_project)
        .build()
        .layer(Extension(store))
}
