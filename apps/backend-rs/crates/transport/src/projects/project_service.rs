//! ProjectService: CreateProject (owner + auto owner membership; local only).

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::project::{
    project_name_ok, ProjectDescription, ProjectMembership, ProjectName, ProjectOwnerId,
    ProjectStatus, ProjectStatusComponent,
};
use persistence::Store;

use super::internal;
use super::record::{load_project, to_proto};
use crate::sedjiwa::tasks::project::v1 as pb;
use crate::sedjiwa::tasks::project::v1::project_service_connect::ProjectServiceBuilder;

/// Permission required to create a project (every active user's token carries it).
const PERM_CREATE: &str = "projects:create";

/// Create a local delivery project: one owner, auto owner membership, status
/// Active. No Core Portal write. Project and membership rows are separate per-op
/// creates (not atomic — acceptable until multi-entity transactions exist).
async fn create_project(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CreateProjectRequest>,
) -> Result<ConnectResponse<pb::Project>, ConnectError> {
    let auth = user
        .map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))?;
    if !auth.has(PERM_CREATE) {
        return Err(ConnectError::new_permission_denied("projects:create required"));
    }
    let ConnectRequest(r) = req;
    let name = r.name.trim();
    if !project_name_ok(name) {
        return Err(ConnectError::new_invalid_argument("name is required"));
    }
    // Owner defaults to the caller.
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

    // Optional description (component absent when empty).
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

    // Owner membership; creator stays a member if a different owner was named.
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

    let p = load_project(&store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| internal("project missing after create"))?;
    Ok(ConnectResponse::new(to_proto(&p)))
}

/// ProjectService router; injects the Store as a request extension.
pub fn project_router(store: Arc<Store>) -> axum::Router<()> {
    ProjectServiceBuilder::<()>::new()
        .create_project::<_, (
            Extension<Arc<Store>>,
            Option<Extension<AuthUser>>,
            ConnectRequest<pb::CreateProjectRequest>,
        )>(create_project)
        .build()
        .layer(Extension(store))
}
