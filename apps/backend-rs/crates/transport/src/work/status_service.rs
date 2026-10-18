//! TaskStatusService: a project's workflow (list + create/update/delete/
//! reorder). All member-gated, like labels. A project always keeps at least one
//! status in each required category (To Do, Done); deleting a status that
//! still has tasks needs a replacement to move them to.

use std::collections::HashSet;
use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::label::{color_ok, label_name_ok};
use domain::task::{required_category, TaskStatus};
use persistence::Store;

use super::status_record::{self, load_status, statuses_for_project, to_proto, StatusRecord};
use super::{internal, parse_pid, require_auth, require_member, StoreExt};
use crate::sedjiwa::tasks::work::v1 as pb;
use crate::sedjiwa::tasks::work::v1::task_status_service_connect::TaskStatusServiceBuilder;

fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

async fn require_status(store: &Store, id: &str) -> Result<StatusRecord, ConnectError> {
    let pid = parse_pid(id)?;
    load_status(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("status not found"))
}

async fn project_statuses(store: &Store, project_id: &str) -> Result<Vec<StatusRecord>, ConnectError> {
    statuses_for_project(store, project_id).await.map_err(internal)
}

/// The status a task write lands on. An explicit `status_id` wins and must
/// belong to `project_id`; otherwise the first status of `category`.
pub(crate) async fn resolve_status(
    store: &Store,
    project_id: &str,
    status_id: Option<&str>,
    category: TaskStatus,
) -> Result<StatusRecord, ConnectError> {
    if let Some(id) = status_id.filter(|s| !s.is_empty()) {
        let s = require_status(store, id).await?;
        if s.project_id != project_id {
            return Err(ConnectError::new_invalid_argument(
                "status belongs to another project",
            ));
        }
        return Ok(s);
    }
    project_statuses(store, project_id)
        .await?
        .into_iter()
        .find(|s| s.category == category)
        .ok_or_else(|| {
            ConnectError::new_invalid_argument(format!(
                "project has no {} status",
                category.as_str()
            ))
        })
}

/// A project's status named `name` (case-insensitive) as (id, category). For
/// callers that take a status by name (the MCP tools).
pub async fn status_by_name(
    store: &Store,
    project_id: &str,
    name: &str,
) -> Result<Option<(String, TaskStatus)>, ConnectError> {
    let wanted = name.trim();
    Ok(project_statuses(store, project_id)
        .await?
        .into_iter()
        .find(|s| s.name.eq_ignore_ascii_case(wanted))
        .map(|s| (s.pid.to_string(), s.category)))
}

fn name_taken(statuses: &[StatusRecord], name: &str, except: i64) -> bool {
    statuses
        .iter()
        .any(|s| s.pid != except && s.name.eq_ignore_ascii_case(name))
}

/// Would `statuses` still hold a status of `category` without `gone`?
fn category_survives(statuses: &[StatusRecord], category: TaskStatus, gone: i64) -> bool {
    statuses.iter().any(|s| s.pid != gone && s.category == category)
}

async fn list_task_statuses(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListTaskStatusesRequest>,
) -> Result<ConnectResponse<pb::ListTaskStatusesResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_member(&store, &r.project_id, &auth).await?;
    let statuses = project_statuses(&store, &r.project_id).await?;
    Ok(ConnectResponse::new(pb::ListTaskStatusesResponse {
        statuses: statuses.iter().map(to_proto).collect(),
    }))
}

async fn create_task_status(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CreateTaskStatusRequest>,
) -> Result<ConnectResponse<pb::TaskStatusDef>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_member(&store, &r.project_id, &auth).await?;
    let name = r.name.trim();
    if !label_name_ok(name) {
        return Err(ConnectError::new_invalid_argument("name is required"));
    }
    if !color_ok(&r.color) {
        return Err(ConnectError::new_invalid_argument("color must be #RRGGBB"));
    }
    let category = TaskStatus::from_proto(r.category)
        .ok_or_else(|| ConnectError::new_invalid_argument("category is required"))?;
    if name_taken(&project_statuses(&store, &r.project_id).await?, name, 0) {
        return Err(ConnectError::new_already_exists("a status with this name exists"));
    }
    let pid = status_record::create_status(&store, &r.project_id, name, &r.color, category)
        .await
        .map_err(internal)?;
    let s = require_status(&store, &pid.to_string()).await?;
    Ok(ConnectResponse::new(to_proto(&s)))
}

async fn update_task_status(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::UpdateTaskStatusRequest>,
) -> Result<ConnectResponse<pb::TaskStatusDef>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let s = require_status(&store, &r.id).await?;
    require_member(&store, &s.project_id, &auth).await?;
    let statuses = project_statuses(&store, &s.project_id).await?;

    let name = match r.name.map(|n| n.trim().to_string()) {
        Some(n) if !label_name_ok(&n) => {
            return Err(ConnectError::new_invalid_argument("name cannot be blank"))
        }
        Some(n) if name_taken(&statuses, &n, s.pid) => {
            return Err(ConnectError::new_already_exists("a status with this name exists"))
        }
        other => other,
    };
    if let Some(color) = &r.color {
        if !color_ok(color) {
            return Err(ConnectError::new_invalid_argument("color must be #RRGGBB"));
        }
    }
    let category = match r.category {
        Some(code) => Some(
            TaskStatus::from_proto(code)
                .ok_or_else(|| ConnectError::new_invalid_argument("invalid category"))?,
        ),
        None => None,
    };
    if let Some(c) = category {
        if c != s.category
            && required_category(s.category)
            && !category_survives(&statuses, s.category, s.pid)
        {
            return Err(ConnectError::new_failed_precondition(format!(
                "a project needs at least one {} status",
                s.category.as_str()
            )));
        }
    }
    status_record::update_status(&store, &s, name, r.color, category, &now_iso())
        .await
        .map_err(internal)?;
    let s = require_status(&store, &r.id).await?;
    Ok(ConnectResponse::new(to_proto(&s)))
}

async fn delete_task_status(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::DeleteTaskStatusRequest>,
) -> Result<ConnectResponse<pb::DeleteTaskStatusResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let s = require_status(&store, &r.id).await?;
    require_member(&store, &s.project_id, &auth).await?;
    let statuses = project_statuses(&store, &s.project_id).await?;
    if required_category(s.category) && !category_survives(&statuses, s.category, s.pid) {
        return Err(ConnectError::new_failed_precondition(format!(
            "a project needs at least one {} status",
            s.category.as_str()
        )));
    }
    let replacement = match r.replacement_id.as_deref().filter(|id| !id.is_empty()) {
        Some(id) if id == r.id => {
            return Err(ConnectError::new_invalid_argument(
                "a status cannot replace itself",
            ))
        }
        Some(id) => {
            let rep = require_status(&store, id).await?;
            if rep.project_id != s.project_id {
                return Err(ConnectError::new_invalid_argument(
                    "replacement belongs to another project",
                ));
            }
            Some(rep)
        }
        None => None,
    };
    if replacement.is_none()
        && status_record::task_count(&store, &s).await.map_err(internal)? > 0
    {
        return Err(ConnectError::new_failed_precondition(
            "status still has tasks; choose a replacement",
        ));
    }
    status_record::delete_status(&store, &s, replacement.as_ref(), &now_iso())
        .await
        .map_err(internal)?;
    Ok(ConnectResponse::new(pb::DeleteTaskStatusResponse { ok: true }))
}

async fn reorder_task_statuses(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ReorderTaskStatusesRequest>,
) -> Result<ConnectResponse<pb::ListTaskStatusesResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_member(&store, &r.project_id, &auth).await?;
    let current: HashSet<String> = project_statuses(&store, &r.project_id)
        .await?
        .iter()
        .map(|s| s.pid.to_string())
        .collect();
    let given: HashSet<String> = r.status_ids.iter().cloned().collect();
    if given != current || given.len() != r.status_ids.len() {
        return Err(ConnectError::new_invalid_argument(
            "status_ids must list every status of the project exactly once",
        ));
    }
    let ids: Vec<i64> = r
        .status_ids
        .iter()
        .map(|id| parse_pid(id))
        .collect::<Result<_, _>>()?;
    status_record::reorder_statuses(&store, &ids)
        .await
        .map_err(internal)?;
    let statuses = project_statuses(&store, &r.project_id).await?;
    Ok(ConnectResponse::new(pb::ListTaskStatusesResponse {
        statuses: statuses.iter().map(to_proto).collect(),
    }))
}

/// TaskStatusService router; injects the Store as a request extension.
pub fn status_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    TaskStatusServiceBuilder::<()>::new()
        .list_task_statuses::<_, (StoreExt, A, ConnectRequest<pb::ListTaskStatusesRequest>)>(
            list_task_statuses,
        )
        .create_task_status::<_, (StoreExt, A, ConnectRequest<pb::CreateTaskStatusRequest>)>(
            create_task_status,
        )
        .update_task_status::<_, (StoreExt, A, ConnectRequest<pb::UpdateTaskStatusRequest>)>(
            update_task_status,
        )
        .delete_task_status::<_, (StoreExt, A, ConnectRequest<pb::DeleteTaskStatusRequest>)>(
            delete_task_status,
        )
        .reorder_task_statuses::<_, (StoreExt, A, ConnectRequest<pb::ReorderTaskStatusesRequest>)>(
            reorder_task_statuses,
        )
        .build()
        .layer(Extension(store))
}
