//! ProjectService: create + read (list/get) + owner authority (status/transfer/delete).

use std::collections::HashSet;
use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::notification::NotificationType;
use domain::project::{
    project_name_ok, ProjectDescription, ProjectMembership, ProjectName, ProjectOwnerId,
    ProjectStatus, ProjectStatusComponent,
};
use persistence::Store;

use super::record::{
    is_member, load_all_projects, load_project, member_project_ids, membership_pids_for_project,
    membership_pids_for_project_user, project_member_ids, to_proto, user_exists, ProjectRecord,
};
use super::{internal, parse_pid};
use crate::activity::record;
use crate::notifications::{emit, NotifRefs, Notifier};
use crate::search::{deindex_project, index, project_doc};
use domain::activity::{ActivityAction, EntityType};
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
    index(
        &store,
        project_doc(&pid.to_string(), &p.name, p.description.as_deref().unwrap_or_default()),
    )
    .await;
    Ok(ConnectResponse::new(to_proto(&p)))
}

/// Member-scoped list (admin sees all) with status/search filters + pagination.
pub async fn list_projects_core(
    store: &Store,
    auth: &AuthUser,
    r: pb::ListProjectsRequest,
) -> Result<pb::ListProjectsResponse, ConnectError> {
    let all = load_all_projects(store).await.map_err(internal)?;

    // Scope to the caller's memberships (admin: all).
    let visible: Vec<ProjectRecord> = if auth.is_admin() {
        all
    } else {
        let mine: HashSet<String> = member_project_ids(store, &auth.id)
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
    Ok(pb::ListProjectsResponse { projects, total })
}

async fn list_projects(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListProjectsRequest>,
) -> Result<ConnectResponse<pb::ListProjectsResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    Ok(ConnectResponse::new(
        list_projects_core(&store, &auth, r).await?,
    ))
}

/// Member-gated read.
pub async fn get_project_core(
    store: &Store,
    auth: &AuthUser,
    r: pb::GetProjectRequest,
) -> Result<pb::Project, ConnectError> {
    let pid = parse_pid(&r.id)?;
    let p = require_project(store, pid).await?;
    if !auth.is_admin()
        && !is_member(store, &pid.to_string(), &auth.id)
            .await
            .map_err(internal)?
    {
        return Err(ConnectError::new_permission_denied("not a member"));
    }
    Ok(to_proto(&p))
}

async fn get_project(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetProjectRequest>,
) -> Result<ConnectResponse<pb::Project>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    Ok(ConnectResponse::new(
        get_project_core(&store, &auth, r).await?,
    ))
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
    notifier: Option<Extension<Arc<Notifier>>>,
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
                user_id: new_owner.clone(),
            },))
            .await
            .map_err(internal)?;
    }
    // Notify the new owner.
    if let Some(Extension(n)) = notifier {
        emit(
            &store,
            &n,
            &new_owner,
            NotificationType::OwnershipTransferred,
            &auth.id,
            "You are now the project owner".to_string(),
            NotifRefs::project(&pid.to_string()),
        )
        .await;
    }
    record(
        &store,
        &pid.to_string(),
        &auth.id,
        EntityType::Ownership,
        &new_owner,
        ActivityAction::Updated,
        "transferred ownership".to_string(),
        vec![],
    )
    .await;
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
    deindex_project(&store, &pid.to_string()).await;
    Ok(ConnectResponse::new(pb::DeleteProjectResponse { ok: true }))
}

/// Build the fresh member list for a project.
async fn members_response(
    store: &Store,
    owner_id: &str,
    project_id: &str,
) -> Result<pb::ListProjectMembersResponse, ConnectError> {
    let ids = project_member_ids(store, project_id).await.map_err(internal)?;
    let members = ids
        .into_iter()
        .map(|uid| pb::Member {
            is_owner: uid == owner_id,
            user_id: uid,
        })
        .collect();
    Ok(pb::ListProjectMembersResponse {
        members,
        owner_id: owner_id.to_string(),
    })
}

/// Member-or-admin: list a project's members.
async fn list_project_members(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListProjectMembersRequest>,
) -> Result<ConnectResponse<pb::ListProjectMembersResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.project_id)?;
    let p = require_project(&store, pid).await?;
    if !auth.is_admin()
        && !is_member(&store, &pid.to_string(), &auth.id)
            .await
            .map_err(internal)?
    {
        return Err(ConnectError::new_permission_denied("not a member"));
    }
    Ok(ConnectResponse::new(
        members_response(&store, &p.owner_id, &pid.to_string()).await?,
    ))
}

/// Owner/admin: add a member (idempotent; user must exist).
async fn add_project_member(
    Extension(store): Extension<Arc<Store>>,
    notifier: Option<Extension<Arc<Notifier>>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::AddProjectMemberRequest>,
) -> Result<ConnectResponse<pb::ListProjectMembersResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.project_id)?;
    let p = require_project(&store, pid).await?;
    require_owner_or_admin(&auth, &p)?;
    let uid = r.user_id.trim().to_string();
    if uid.is_empty() {
        return Err(ConnectError::new_invalid_argument("user_id is required"));
    }
    if !user_exists(&store, &uid).await.map_err(internal)? {
        return Err(ConnectError::new_not_found("user not found"));
    }
    if !is_member(&store, &pid.to_string(), &uid)
        .await
        .map_err(internal)?
    {
        store
            .create((ProjectMembership {
                project_id: pid.to_string(),
                user_id: uid.clone(),
            },))
            .await
            .map_err(internal)?;
        // Notify the newly-added member.
        if let Some(Extension(n)) = notifier {
            emit(
                &store,
                &n,
                &uid,
                NotificationType::ProjectMemberAdded,
                &auth.id,
                "You were added to a project".to_string(),
                NotifRefs::project(&pid.to_string()),
            )
            .await;
        }
        record(
            &store,
            &pid.to_string(),
            &auth.id,
            EntityType::Membership,
            &uid,
            ActivityAction::Created,
            "added a member".to_string(),
            vec![],
        )
        .await;
    }
    Ok(ConnectResponse::new(
        members_response(&store, &p.owner_id, &pid.to_string()).await?,
    ))
}

/// Owner/admin: remove a member. The owner cannot be removed (transfer first);
/// removing a non-member is a no-op success.
async fn remove_project_member(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::RemoveProjectMemberRequest>,
) -> Result<ConnectResponse<pb::ListProjectMembersResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.project_id)?;
    let p = require_project(&store, pid).await?;
    require_owner_or_admin(&auth, &p)?;
    let uid = r.user_id.trim().to_string();
    if uid == p.owner_id {
        return Err(ConnectError::new_failed_precondition(
            "cannot remove the owner; transfer ownership first",
        ));
    }
    let removed = membership_pids_for_project_user(&store, &pid.to_string(), &uid)
        .await
        .map_err(internal)?;
    let was_member = !removed.is_empty();
    for mpid in removed {
        store.delete(mpid).await.map_err(internal)?;
    }
    if was_member {
        record(
            &store,
            &pid.to_string(),
            &auth.id,
            EntityType::Membership,
            &uid,
            ActivityAction::Deleted,
            "removed a member".to_string(),
            vec![],
        )
        .await;
    }
    Ok(ConnectResponse::new(
        members_response(&store, &p.owner_id, &pid.to_string()).await?,
    ))
}

/// Self-leave. The caller must be a member; the owner cannot leave.
async fn leave_project(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::LeaveProjectRequest>,
) -> Result<ConnectResponse<pb::LeaveProjectResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.project_id)?;
    let p = require_project(&store, pid).await?;
    if !is_member(&store, &pid.to_string(), &auth.id)
        .await
        .map_err(internal)?
    {
        return Err(ConnectError::new_failed_precondition("not a member"));
    }
    if auth.id == p.owner_id {
        return Err(ConnectError::new_failed_precondition(
            "owner cannot leave; transfer ownership first",
        ));
    }
    for mpid in membership_pids_for_project_user(&store, &pid.to_string(), &auth.id)
        .await
        .map_err(internal)?
    {
        store.delete(mpid).await.map_err(internal)?;
    }
    Ok(ConnectResponse::new(pb::LeaveProjectResponse { ok: true }))
}

/// ProjectService router; injects the Store as a request extension.
pub fn project_router(store: Arc<Store>) -> axum::Router<()> {
    type S = Extension<Arc<Store>>;
    type A = Option<Extension<AuthUser>>;
    type N = Option<Extension<Arc<Notifier>>>;
    ProjectServiceBuilder::<()>::new()
        .create_project::<_, (S, A, ConnectRequest<pb::CreateProjectRequest>)>(create_project)
        .list_projects::<_, (S, A, ConnectRequest<pb::ListProjectsRequest>)>(list_projects)
        .get_project::<_, (S, A, ConnectRequest<pb::GetProjectRequest>)>(get_project)
        .set_project_status::<_, (S, A, ConnectRequest<pb::SetProjectStatusRequest>)>(
            set_project_status,
        )
        .transfer_project_ownership::<_, (
            S,
            N,
            A,
            ConnectRequest<pb::TransferProjectOwnershipRequest>,
        )>(transfer_project_ownership)
        .delete_project::<_, (S, A, ConnectRequest<pb::DeleteProjectRequest>)>(delete_project)
        .list_project_members::<_, (S, A, ConnectRequest<pb::ListProjectMembersRequest>)>(
            list_project_members,
        )
        .add_project_member::<_, (S, N, A, ConnectRequest<pb::AddProjectMemberRequest>)>(
            add_project_member,
        )
        .remove_project_member::<_, (S, A, ConnectRequest<pb::RemoveProjectMemberRequest>)>(
            remove_project_member,
        )
        .leave_project::<_, (S, A, ConnectRequest<pb::LeaveProjectRequest>)>(leave_project)
        .build()
        .layer(Extension(store))
}
