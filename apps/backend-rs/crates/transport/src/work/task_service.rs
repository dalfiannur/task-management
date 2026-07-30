//! TaskService: list + create/update/delete/move. All member-gated (project is
//! derived from the task's module). Assignees must be project members;
//! `completed_at` is maintained automatically around the Done status.

use std::collections::HashSet;
use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::task::{
    dates_ok, title_ok, TaskAssignees, TaskAudit, TaskInfo, TaskLabels, TaskModuleRef,
    TaskPriority, TaskStatus,
};
use persistence::Store;

use super::record::{load_module, modules_for_project};
use super::task_record::{load_task, tasks_for_module, tasks_for_modules, to_proto, TaskRecord};
use super::{internal, parse_pid, require_auth, require_member, StoreExt};
use crate::activity::record;
use crate::notifications::{emit, NotifRefs, Notifier};
use crate::projects::record::project_member_ids;
use domain::activity::{ActivityAction, EntityType, FieldChange};
use domain::notification::NotificationType;
use crate::sedjiwa::tasks::work::v1 as pb;
use crate::sedjiwa::tasks::work::v1::task_service_connect::TaskServiceBuilder;

fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

/// Resolve a module id → (module pid, project_id), or `not_found`.
async fn module_project(store: &Store, module_id: &str) -> Result<(i64, String), ConnectError> {
    let mpid = parse_pid(module_id)?;
    let m = load_module(store, mpid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("module not found"))?;
    Ok((mpid, m.project_id))
}

async fn require_task(store: &Store, pid: i64) -> Result<TaskRecord, ConnectError> {
    load_task(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("task not found"))
}

/// Every assignee must be a member of `project_id`.
async fn validate_assignees(
    store: &Store,
    project_id: &str,
    assignees: &[String],
) -> Result<(), ConnectError> {
    if assignees.is_empty() {
        return Ok(());
    }
    let members: HashSet<String> = project_member_ids(store, project_id)
        .await
        .map_err(internal)?
        .into_iter()
        .collect();
    if assignees.iter().all(|a| members.contains(a)) {
        Ok(())
    } else {
        Err(ConnectError::new_invalid_argument(
            "every assignee must be a project member",
        ))
    }
}

async fn next_order_in_module(store: &Store, module_id: &str) -> Result<i32, ConnectError> {
    let existing = tasks_for_module(store, module_id).await.map_err(internal)?;
    Ok(existing.iter().map(|t| t.order).max().map(|m| m + 1).unwrap_or(0))
}

async fn list_tasks(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListTasksRequest>,
) -> Result<ConnectResponse<pb::ListTasksResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_member(&store, &r.project_id, &auth).await?;
    let module_ids: HashSet<String> = modules_for_project(&store, &r.project_id)
        .await
        .map_err(internal)?
        .into_iter()
        .map(|m| m.pid.to_string())
        .collect();
    let mut tasks = tasks_for_modules(&store, module_ids).await.map_err(internal)?;
    if let Some(mid) = r.module_id.filter(|s| !s.is_empty()) {
        tasks.retain(|t| t.module_id == mid);
    }
    Ok(ConnectResponse::new(pb::ListTasksResponse {
        tasks: tasks.iter().map(to_proto).collect(),
    }))
}

async fn create_task(
    Extension(store): StoreExt,
    notifier: Option<Extension<Arc<Notifier>>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CreateTaskRequest>,
) -> Result<ConnectResponse<pb::Task>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let (_mpid, project_id) = module_project(&store, &r.module_id).await?;
    require_member(&store, &project_id, &auth).await?;

    let title = r.title.trim();
    if !title_ok(title) {
        return Err(ConnectError::new_invalid_argument("title is required"));
    }
    validate_assignees(&store, &project_id, &r.assignee_ids).await?;
    let assignees = r.assignee_ids.clone();

    let status = TaskStatus::from_proto(r.status).unwrap_or(TaskStatus::Todo);
    let priority = TaskPriority::from_proto(r.priority).unwrap_or(TaskPriority::None);
    let start_date = r.start_date.filter(|s| !s.is_empty());
    let due_date = r.due_date.filter(|s| !s.is_empty());
    if !dates_ok(start_date.as_deref(), due_date.as_deref()) {
        return Err(ConnectError::new_invalid_argument(
            "start_date must be on or before due_date",
        ));
    }
    let order = next_order_in_module(&store, &r.module_id).await?;
    let now = now_iso();
    let completed_at = (status == TaskStatus::Done).then(|| now.clone());

    let pid = store
        .create((
            TaskInfo {
                title: title.to_string(),
                description: domain::sanitize::clean_html(&r.description.unwrap_or_default()),
                status: status.as_str().to_string(),
                priority: priority.as_str().to_string(),
                start_date,
                due_date,
                sort_order: order,
            },
            TaskModuleRef {
                module_id: r.module_id.clone(),
            },
            TaskAssignees {
                user_ids: r.assignee_ids,
            },
            TaskLabels {
                label_ids: r.label_ids,
            },
            TaskAudit {
                created_at: now.clone(),
                updated_at: now,
                completed_at,
                created_by: auth.id.clone(),
            },
        ))
        .await
        .map_err(internal)?;
    // Notify each assignee (emit no-ops on self-assignment).
    if let Some(Extension(n)) = notifier {
        let refs = NotifRefs::task(&project_id, &pid.to_string());
        for a in &assignees {
            emit(
                &store,
                &n,
                a,
                NotificationType::TaskAssigned,
                &auth.id,
                "You were assigned to a task".to_string(),
                refs.clone(),
            )
            .await;
        }
    }
    record(
        &store,
        &project_id,
        &auth.id,
        EntityType::Task,
        &pid.to_string(),
        ActivityAction::Created,
        format!("created task '{title}'"),
        vec![],
    )
    .await;
    let t = require_task(&store, pid).await?;
    Ok(ConnectResponse::new(to_proto(&t)))
}

async fn update_task(
    Extension(store): StoreExt,
    notifier: Option<Extension<Arc<Notifier>>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::UpdateTaskRequest>,
) -> Result<ConnectResponse<pb::Task>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let t = require_task(&store, pid).await?;
    let (_mpid, project_id) = module_project(&store, &t.module_id).await?;
    require_member(&store, &project_id, &auth).await?;

    // Patch scalar fields.
    let title = match r.title {
        Some(s) if !title_ok(&s) => {
            return Err(ConnectError::new_invalid_argument("title cannot be blank"))
        }
        Some(s) => s.trim().to_string(),
        None => t.title.clone(),
    };
    let description = domain::sanitize::clean_html(&r.description.unwrap_or_else(|| t.description.clone()));
    let status = match r.status {
        Some(code) => TaskStatus::from_proto(code)
            .ok_or_else(|| ConnectError::new_invalid_argument("invalid status"))?,
        None => t.status,
    };
    let priority = match r.priority {
        Some(code) => TaskPriority::from_proto(code)
            .ok_or_else(|| ConnectError::new_invalid_argument("invalid priority"))?,
        None => t.priority,
    };
    // Dates: Some("") clears, Some(v) sets, None keeps.
    let clean = |opt: Option<String>, cur: Option<String>| match opt {
        Some(s) if s.is_empty() => None,
        Some(s) => Some(s),
        None => cur,
    };
    let start_date = clean(r.start_date, t.start_date.clone());
    let due_date = clean(r.due_date, t.due_date.clone());
    if !dates_ok(start_date.as_deref(), due_date.as_deref()) {
        return Err(ConnectError::new_invalid_argument(
            "start_date must be on or before due_date",
        ));
    }

    // Assignees / labels: present wrapper = replace, absent = unchanged.
    let assignees = match r.assignee_ids {
        Some(list) => list.values,
        None => t.assignee_ids.clone(),
    };
    validate_assignees(&store, &project_id, &assignees).await?;
    let labels = match r.label_ids {
        Some(list) => list.values,
        None => t.label_ids.clone(),
    };

    // completed_at automation around Done.
    let now = now_iso();
    let completed_at = if status == TaskStatus::Done {
        if t.status == TaskStatus::Done {
            t.completed_at.clone()
        } else {
            Some(now.clone())
        }
    } else {
        None
    };

    // Diff for the audit log (important fields only, spec §8.1).
    let mut changes = Vec::new();
    if status != t.status {
        changes.push(FieldChange {
            field: "status".into(),
            from: Some(t.status.as_str().into()),
            to: Some(status.as_str().into()),
        });
    }
    if priority != t.priority {
        changes.push(FieldChange {
            field: "priority".into(),
            from: Some(t.priority.as_str().into()),
            to: Some(priority.as_str().into()),
        });
    }
    if title != t.title {
        changes.push(FieldChange {
            field: "title".into(),
            from: Some(t.title.clone()),
            to: Some(title.clone()),
        });
    }
    if start_date != t.start_date {
        changes.push(FieldChange {
            field: "start_date".into(),
            from: t.start_date.clone(),
            to: start_date.clone(),
        });
    }
    if due_date != t.due_date {
        changes.push(FieldChange {
            field: "due_date".into(),
            from: t.due_date.clone(),
            to: due_date.clone(),
        });
    }
    let summary = format!("updated task '{title}'");

    let info = TaskInfo {
        title,
        description,
        status: status.as_str().to_string(),
        priority: priority.as_str().to_string(),
        start_date,
        due_date,
        sort_order: t.order,
    };
    let audit = TaskAudit {
        created_at: t.created_at.clone(),
        updated_at: now,
        completed_at,
        created_by: t.created_by.clone(),
    };
    let new_assignees = assignees.clone();
    store
        .update(pid, move |w, e| {
            w.remove::<TaskInfo>(e);
            w.insert(e, info);
            w.remove::<TaskAudit>(e);
            w.insert(e, audit);
            w.remove::<TaskAssignees>(e);
            w.insert(e, TaskAssignees { user_ids: assignees });
            w.remove::<TaskLabels>(e);
            w.insert(e, TaskLabels { label_ids: labels });
        })
        .await
        .map_err(internal)?;
    // Notify only newly-added assignees.
    if let Some(Extension(n)) = notifier {
        let refs = NotifRefs::task(&project_id, &pid.to_string());
        for a in new_assignees.iter().filter(|a| !t.assignee_ids.contains(a)) {
            emit(
                &store,
                &n,
                a,
                NotificationType::TaskAssigned,
                &auth.id,
                "You were assigned to a task".to_string(),
                refs.clone(),
            )
            .await;
        }
    }
    record(
        &store,
        &project_id,
        &auth.id,
        EntityType::Task,
        &pid.to_string(),
        ActivityAction::Updated,
        summary,
        changes,
    )
    .await;
    let t = require_task(&store, pid).await?;
    Ok(ConnectResponse::new(to_proto(&t)))
}

async fn delete_task(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::DeleteTaskRequest>,
) -> Result<ConnectResponse<pb::DeleteTaskResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let t = require_task(&store, pid).await?;
    let (_mpid, project_id) = module_project(&store, &t.module_id).await?;
    require_member(&store, &project_id, &auth).await?;
    store.delete(pid).await.map_err(internal)?;
    record(
        &store,
        &project_id,
        &auth.id,
        EntityType::Task,
        &pid.to_string(),
        ActivityAction::Deleted,
        format!("deleted task '{}'", t.title),
        vec![],
    )
    .await;
    Ok(ConnectResponse::new(pb::DeleteTaskResponse { ok: true }))
}

async fn move_task(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::MoveTaskRequest>,
) -> Result<ConnectResponse<pb::Task>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let t = require_task(&store, pid).await?;
    let (_old_mpid, old_project) = module_project(&store, &t.module_id).await?;
    require_member(&store, &old_project, &auth).await?;
    // Destination module must be in the same project.
    let (_dest_mpid, dest_project) = module_project(&store, &r.module_id).await?;
    if dest_project != old_project {
        return Err(ConnectError::new_invalid_argument(
            "destination module is in a different project",
        ));
    }
    let module_id = r.module_id.clone();
    let order = r.order;
    let now = now_iso();
    let info = TaskInfo {
        title: t.title.clone(),
        description: t.description.clone(),
        status: t.status.as_str().to_string(),
        priority: t.priority.as_str().to_string(),
        start_date: t.start_date.clone(),
        due_date: t.due_date.clone(),
        sort_order: order,
    };
    let audit = TaskAudit {
        created_at: t.created_at.clone(),
        updated_at: now,
        completed_at: t.completed_at.clone(),
        created_by: t.created_by.clone(),
    };
    store
        .update(pid, move |w, e| {
            w.remove::<TaskInfo>(e);
            w.insert(e, info);
            w.remove::<TaskModuleRef>(e);
            w.insert(e, TaskModuleRef { module_id });
            w.remove::<TaskAudit>(e);
            w.insert(e, audit);
        })
        .await
        .map_err(internal)?;
    let t = require_task(&store, pid).await?;
    Ok(ConnectResponse::new(to_proto(&t)))
}

/// TaskService router; injects the Store as a request extension.
pub fn task_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    type N = Option<Extension<Arc<Notifier>>>;
    TaskServiceBuilder::<()>::new()
        .list_tasks::<_, (StoreExt, A, ConnectRequest<pb::ListTasksRequest>)>(list_tasks)
        .create_task::<_, (StoreExt, N, A, ConnectRequest<pb::CreateTaskRequest>)>(create_task)
        .update_task::<_, (StoreExt, N, A, ConnectRequest<pb::UpdateTaskRequest>)>(update_task)
        .delete_task::<_, (StoreExt, A, ConnectRequest<pb::DeleteTaskRequest>)>(delete_task)
        .move_task::<_, (StoreExt, A, ConnectRequest<pb::MoveTaskRequest>)>(move_task)
        .build()
        .layer(Extension(store))
}
