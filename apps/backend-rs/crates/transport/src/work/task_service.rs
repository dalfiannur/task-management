//! TaskService: list + create/update/delete/move. All member-gated (project is
//! derived from the task's module). Assignees must be project members;
//! `completed_at` is maintained automatically around the Done status.

use std::collections::HashSet;
use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::task::{dates_ok, estimate_ok, title_ok, TaskPriority, TaskStatus};
use persistence::Store;

use super::record::{load_module, modules_for_project};
use super::status_service::resolve_status;
use super::task_record::{
    self, load_task, tasks_for_modules, to_proto, TaskFields, TaskRecord,
};
use super::{
    internal, parse_pid, require_auth, require_member, strip_dependency, validate_blocked_by,
    validate_parent, StoreExt,
};
use crate::activity::record;
use crate::notifications::{emit, NotifRefs, Notifier};
use crate::projects::record::project_member_ids;
use crate::search::{index, task_doc};
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
///
/// `pub` (not `pub(crate)`) so `transport::api` can re-export it: the
/// `list_tasks` MCP tool needs to turn a bare `module_id` into the
/// `project_id` `ListTasksRequest` requires, and this is the same lookup
/// every mutating handler in this file already does before its membership
/// check — reusing it keeps that resolution in one place rather than a
/// second copy in `mcp`.
pub async fn module_project(store: &Store, module_id: &str) -> Result<(i64, String), ConnectError> {
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

/// A requested estimate, range-checked; `None` when not sent.
fn estimate_arg(minutes: Option<i32>) -> Result<Option<i32>, ConnectError> {
    match minutes {
        Some(m) if !estimate_ok(m) => Err(ConnectError::new_invalid_argument(
            "estimate must be between 0 and 1000 hours",
        )),
        other => Ok(other),
    }
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

/// Single task by id — the read a deep-linked dialog needs when no list has
/// been loaded. Member-gated through the task's module → project.
pub async fn get_task_core(
    store: &Store,
    auth: &AuthUser,
    r: pb::GetTaskRequest,
) -> Result<pb::Task, ConnectError> {
    let pid = parse_pid(&r.id)?;
    let t = require_task(store, pid).await?;
    let (_, project_id) = module_project(store, &t.module_id).await?;
    require_member(store, &project_id, auth).await?;
    Ok(to_proto(&t))
}

async fn get_task(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetTaskRequest>,
) -> Result<ConnectResponse<pb::Task>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    Ok(ConnectResponse::new(get_task_core(&store, &auth, r).await?))
}

/// All tasks in a project (optionally narrowed to one module). Member-gated.
pub async fn list_tasks_core(
    store: &Store,
    auth: &AuthUser,
    r: pb::ListTasksRequest,
) -> Result<pb::ListTasksResponse, ConnectError> {
    require_member(store, &r.project_id, auth).await?;
    let module_ids: HashSet<String> = modules_for_project(store, &r.project_id)
        .await
        .map_err(internal)?
        .into_iter()
        .map(|m| m.pid.to_string())
        .collect();
    let mut tasks = tasks_for_modules(store, module_ids).await.map_err(internal)?;
    if let Some(mid) = r.module_id.filter(|s| !s.is_empty()) {
        tasks.retain(|t| t.module_id == mid);
    }
    Ok(pb::ListTasksResponse {
        tasks: tasks.iter().map(to_proto).collect(),
    })
}

async fn list_tasks(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListTasksRequest>,
) -> Result<ConnectResponse<pb::ListTasksResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    Ok(ConnectResponse::new(list_tasks_core(&store, &auth, r).await?))
}

/// Create a task in a module (or as a subtask of `parent_id`). Member-gated;
/// validates title/dates/assignees, notifies newly-assigned members, and
/// records activity + search index entries.
pub async fn create_task_core(
    store: &Store,
    notifier: Option<&Arc<Notifier>>,
    auth: &AuthUser,
    r: pb::CreateTaskRequest,
) -> Result<pb::Task, ConnectError> {
    let (_mpid, project_id) = module_project(store, &r.module_id).await?;
    require_member(store, &project_id, auth).await?;

    let title = r.title.trim();
    if !title_ok(title) {
        return Err(ConnectError::new_invalid_argument("title is required"));
    }
    validate_assignees(store, &project_id, &r.assignee_ids).await?;
    let assignees = r.assignee_ids.clone();

    let category = TaskStatus::from_proto(r.status).unwrap_or(TaskStatus::Todo);
    let st = resolve_status(store, &project_id, r.status_id.as_deref(), category).await?;
    let status = st.category;
    let priority = TaskPriority::from_proto(r.priority).unwrap_or(TaskPriority::None);
    let start_date = r.start_date.filter(|s| !s.is_empty());
    let due_date = r.due_date.filter(|s| !s.is_empty());
    if !dates_ok(start_date.as_deref(), due_date.as_deref()) {
        return Err(ConnectError::new_invalid_argument(
            "start_date must be on or before due_date",
        ));
    }
    let estimate_minutes = estimate_arg(r.estimate_minutes)?.filter(|m| *m > 0);
    // A subtask lives in its parent's module; the request's module_id is
    // ignored rather than trusted, so the invariant cannot be bypassed.
    let (module_id, parent_id) = match r.parent_id.as_deref().filter(|s| !s.is_empty()) {
        Some(p) => (
            validate_parent(store, &project_id, p, 0).await?,
            Some(p.to_string()),
        ),
        None => (r.module_id.clone(), None),
    };
    let now = now_iso();
    let completed_at = (status == TaskStatus::Done).then(|| now.clone());
    let description_for_index = domain::sanitize::clean_html(&r.description.unwrap_or_default());

    let pid = task_record::create_task(
        store,
        &module_id,
        parent_id.as_deref(),
        &auth.id,
        TaskFields {
            title: title.to_string(),
            description: description_for_index.clone(),
            status,
            status_id: Some(st.pid.to_string()),
            estimate_minutes,
            priority,
            start_date,
            due_date,
            assignee_ids: r.assignee_ids,
            label_ids: r.label_ids,
            updated_at: now,
            completed_at,
        },
    )
    .await
    .map_err(internal)?;
    // Notify each assignee (emit no-ops on self-assignment).
    if let Some(n) = notifier {
        let refs = NotifRefs::task(&project_id, &pid.to_string());
        for a in &assignees {
            emit(
                store,
                n,
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
        store,
        &project_id,
        &auth.id,
        EntityType::Task,
        &pid.to_string(),
        ActivityAction::Created,
        format!("created task '{title}'"),
        vec![],
    )
    .await;
    index(
        store,
        task_doc(
            &pid.to_string(),
            &project_id,
            title,
            &description_for_index,
            assignees.clone(),
            parent_id.clone(),
        ),
    )
    .await;
    let t = require_task(store, pid).await?;
    Ok(to_proto(&t))
}

async fn create_task(
    Extension(store): StoreExt,
    notifier: Option<Extension<Arc<Notifier>>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CreateTaskRequest>,
) -> Result<ConnectResponse<pb::Task>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let n = notifier.as_ref().map(|Extension(n)| n);
    Ok(ConnectResponse::new(
        create_task_core(&store, n, &auth, r).await?,
    ))
}

/// Patch a task's fields (only those present in `r` change). Member-gated;
/// notifies newly-added assignees and re-indexes the task for search.
pub async fn update_task_core(
    store: &Store,
    notifier: Option<&Arc<Notifier>>,
    auth: &AuthUser,
    r: pb::UpdateTaskRequest,
) -> Result<pb::Task, ConnectError> {
    let pid = parse_pid(&r.id)?;
    let t = require_task(store, pid).await?;
    let (_mpid, project_id) = module_project(store, &t.module_id).await?;
    require_member(store, &project_id, auth).await?;

    // Patch scalar fields.
    let title = match r.title {
        Some(s) if !title_ok(&s) => {
            return Err(ConnectError::new_invalid_argument("title cannot be blank"))
        }
        Some(s) => s.trim().to_string(),
        None => t.title.clone(),
    };
    let description = domain::sanitize::clean_html(&r.description.unwrap_or_else(|| t.description.clone()));
    // Status: an explicit `status_id` wins; a bare category keeps the current
    // status when it is already in that category, else takes its first one.
    let category = match r.status {
        Some(code) => Some(
            TaskStatus::from_proto(code)
                .ok_or_else(|| ConnectError::new_invalid_argument("invalid status"))?,
        ),
        None => None,
    };
    let new_status = match (r.status_id.as_deref().filter(|s| !s.is_empty()), category) {
        (Some(id), _) => Some(resolve_status(store, &project_id, Some(id), t.status).await?),
        (None, Some(c)) if c != t.status => {
            Some(resolve_status(store, &project_id, None, c).await?)
        }
        _ => None,
    };
    let status = new_status.as_ref().map_or(t.status, |s| s.category);
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

    // Estimate: absent keeps, 0 clears, else sets.
    let estimate_minutes = match estimate_arg(r.estimate_minutes)? {
        Some(0) => None,
        Some(m) => Some(m),
        None => t.estimate_minutes,
    };

    // Assignees / labels: present wrapper = replace, absent = unchanged.
    let assignees = match r.assignee_ids {
        Some(list) => list.values,
        None => t.assignee_ids.clone(),
    };
    validate_assignees(store, &project_id, &assignees).await?;
    let labels = match r.label_ids {
        Some(list) => list.values,
        None => t.label_ids.clone(),
    };

    // Dependencies: present wrapper = replace, absent = unchanged.
    let blocked_by = match r.blocked_by_ids {
        Some(list) => validate_blocked_by(store, &project_id, pid, &list.values).await?,
        None => t.blocked_by_ids.clone(),
    };
    // Re-parenting: absent = unchanged, empty = detach, one = set.
    let new_parent: Option<Option<String>> = match r.parent_id_set {
        None => None,
        Some(list) if list.values.is_empty() => Some(None),
        Some(list) if list.values.len() == 1 => {
            let p = list.values[0].clone();
            validate_parent(store, &project_id, &p, pid).await?;
            Some(Some(p))
        }
        Some(_) => {
            return Err(ConnectError::new_invalid_argument(
                "parent_id_set takes at most one id",
            ))
        }
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
    if let Some(s) = new_status.as_ref().filter(|s| s.pid.to_string() != t.status_id) {
        let label = |name: &str, c: TaskStatus| {
            if name.is_empty() { c.as_str().to_string() } else { name.to_string() }
        };
        changes.push(FieldChange {
            field: "status".into(),
            from: Some(label(&t.status_name, t.status)),
            to: Some(label(&s.name, s.category)),
        });
    }
    if priority != t.priority {
        changes.push(FieldChange {
            field: "priority".into(),
            from: Some(t.priority.as_str().into()),
            to: Some(priority.as_str().into()),
        });
    }
    if estimate_minutes != t.estimate_minutes {
        changes.push(FieldChange {
            field: "estimate".into(),
            from: t.estimate_minutes.map(domain::task::format_minutes),
            to: estimate_minutes.map(domain::task::format_minutes),
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

    let new_assignees = assignees.clone();
    task_record::update_task(
        store,
        pid,
        TaskFields {
            title,
            description,
            status,
            status_id: new_status.map(|s| s.pid.to_string()),
            estimate_minutes,
            priority,
            start_date,
            due_date,
            assignee_ids: assignees,
            label_ids: labels,
            updated_at: now,
            completed_at,
        },
        blocked_by,
        new_parent,
    )
    .await
    .map_err(internal)?;
    // Notify only newly-added assignees.
    if let Some(n) = notifier {
        let refs = NotifRefs::task(&project_id, &pid.to_string());
        for a in new_assignees.iter().filter(|a| !t.assignee_ids.contains(a)) {
            emit(
                store,
                n,
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
        store,
        &project_id,
        &auth.id,
        EntityType::Task,
        &pid.to_string(),
        ActivityAction::Updated,
        summary,
        changes,
    )
    .await;
    let t = require_task(store, pid).await?;
    index(
        store,
        task_doc(
            &pid.to_string(),
            &project_id,
            &t.title,
            &t.description,
            t.assignee_ids.clone(),
            t.parent_id.clone(),
        ),
    )
    .await;
    Ok(to_proto(&t))
}

async fn update_task(
    Extension(store): StoreExt,
    notifier: Option<Extension<Arc<Notifier>>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::UpdateTaskRequest>,
) -> Result<ConnectResponse<pb::Task>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let n = notifier.as_ref().map(|Extension(n)| n);
    Ok(ConnectResponse::new(
        update_task_core(&store, n, &auth, r).await?,
    ))
}

async fn delete_task(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::DeleteTaskRequest>,
) -> Result<ConnectResponse<pb::DeleteTaskResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    delete_task_core(&store, &auth, pid).await?;
    Ok(ConnectResponse::new(pb::DeleteTaskResponse { ok: true }))
}

/// Delete a task and its subtasks; returns every id removed. Member-gated.
async fn delete_task_core(
    store: &Store,
    auth: &AuthUser,
    pid: i64,
) -> Result<Vec<String>, ConnectError> {
    let t = require_task(store, pid).await?;
    let (_mpid, project_id) = module_project(store, &t.module_id).await?;
    require_member(store, &project_id, auth).await?;
    // Cascade to subtasks first, so each leaves the search index too. Their
    // ids join the parent's below so the dependency strip covers all of them.
    let mut gone_ids: Vec<String> = vec![pid.to_string()];
    for spid in task_record::delete_task(store, pid).await.map_err(internal)? {
        super::deindex_task_and_comments(store, &spid.to_string()).await;
        gone_ids.push(spid.to_string());
    }
    record(
        store,
        &project_id,
        &auth.id,
        EntityType::Task,
        &pid.to_string(),
        ActivityAction::Deleted,
        format!("deleted task '{}'", t.title),
        vec![],
    )
    .await;
    super::deindex_task_and_comments(store, &pid.to_string()).await;
    // Drop these ids from every task that listed one as a blocker, or those
    // lists accumulate ids that resolve to nothing and cannot be rendered.
    // One pass over the project covers the parent and every cascaded
    // subtask, rather than re-scanning once per child.
    strip_dependency(store, &project_id, &gone_ids)
        .await
        .map_err(internal)?;
    Ok(gone_ids)
}

/// Move a task (and its subtasks) to another module in the same project, and
/// re-order it there. Member-gated on both the source and destination project.
pub async fn move_task_core(
    store: &Store,
    auth: &AuthUser,
    r: pb::MoveTaskRequest,
) -> Result<pb::Task, ConnectError> {
    let pid = parse_pid(&r.id)?;
    let t = require_task(store, pid).await?;
    let (_old_mpid, old_project) = module_project(store, &t.module_id).await?;
    require_member(store, &old_project, auth).await?;
    // Destination module must be in the same project.
    let (_dest_mpid, dest_project) = module_project(store, &r.module_id).await?;
    if dest_project != old_project {
        return Err(ConnectError::new_invalid_argument(
            "destination module is in a different project",
        ));
    }
    // A subtask always lives in its parent's module; moving the parent moves
    // the children rather than leaving them behind in the old module.
    task_record::move_task(store, pid, &r.module_id, r.order, &now_iso())
        .await
        .map_err(internal)?;
    let t = require_task(store, pid).await?;
    // `unwrap_or_default()` here would turn a `None` (module deleted out from
    // under this move — a narrow race) into `Some("")`. An empty string is
    // not `NULL`, so it would fail the `project_id IS NULL OR project_id =
    // ANY($3)` membership filter for every non-admin: the document would
    // become permanently invisible to normal users while still sitting in
    // the index, until someone runs `reindex`. Skipping the call on `None`
    // just leaves the document stale — the honest outcome, since the index
    // is already allowed to lag and `reindex` repairs it.
    if let Some(moved_project) = super::task_project_id(store, &pid.to_string())
        .await
        .map_err(internal)?
    {
        index(
            store,
            task_doc(
                &pid.to_string(),
                &moved_project,
                &t.title,
                &t.description,
                t.assignee_ids.clone(),
                t.parent_id.clone(),
            ),
        )
        .await;
    }
    Ok(to_proto(&t))
}

async fn move_task(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::MoveTaskRequest>,
) -> Result<ConnectResponse<pb::Task>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    Ok(ConnectResponse::new(move_task_core(&store, &auth, r).await?))
}

/// Most tasks one bulk call may touch.
const MAX_BULK: usize = 200;

/// The bulk ids, de-duplicated in order, with their tasks and shared project —
/// or an error for the whole call: none at all, too many, one missing, or more
/// than one project. Member-gated on that project.
async fn bulk_targets(
    store: &Store,
    auth: &AuthUser,
    ids: &[String],
) -> Result<(String, Vec<TaskRecord>), ConnectError> {
    let mut seen = HashSet::new();
    let ids: Vec<&String> = ids.iter().filter(|id| seen.insert(id.as_str())).collect();
    if ids.is_empty() {
        return Err(ConnectError::new_invalid_argument("task_ids is required"));
    }
    if ids.len() > MAX_BULK {
        return Err(ConnectError::new_invalid_argument(format!(
            "at most {MAX_BULK} tasks at once"
        )));
    }
    let mut project: Option<String> = None;
    let mut tasks = Vec::with_capacity(ids.len());
    for id in ids {
        let t = require_task(store, parse_pid(id)?).await?;
        let (_, p) = module_project(store, &t.module_id).await?;
        match &project {
            None => project = Some(p),
            Some(q) if *q != p => {
                return Err(ConnectError::new_invalid_argument(
                    "every task must be in the same project",
                ))
            }
            Some(_) => {}
        }
        tasks.push(t);
    }
    let project = project.unwrap_or_default();
    require_member(store, &project, auth).await?;
    Ok((project, tasks))
}

/// `current` with `add` appended (once each) and `remove` taken out.
fn edit_ids(current: &[String], add: &[String], remove: &[String]) -> Vec<String> {
    let mut out: Vec<String> = current.iter().filter(|x| !remove.contains(x)).cloned().collect();
    for a in add {
        if !out.contains(a) && !remove.contains(a) {
            out.push(a.clone());
        }
    }
    out
}

async fn bulk_update_tasks(
    Extension(store): StoreExt,
    notifier: Option<Extension<Arc<Notifier>>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::BulkUpdateTasksRequest>,
) -> Result<ConnectResponse<pb::BulkUpdateTasksResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let n = notifier.as_ref().map(|Extension(n)| n);
    let (project_id, tasks) = bulk_targets(&store, &auth, &r.task_ids).await?;

    // What can be checked once is checked once, so a bad value fails the
    // call instead of every task in turn.
    let status_id = match r.status_id.as_deref().filter(|s| !s.is_empty()) {
        Some(id) => Some(
            resolve_status(&store, &project_id, Some(id), TaskStatus::Todo)
                .await?
                .pid
                .to_string(),
        ),
        None => None,
    };
    if let Some(code) = r.priority {
        TaskPriority::from_proto(code)
            .ok_or_else(|| ConnectError::new_invalid_argument("invalid priority"))?;
    }
    validate_assignees(&store, &project_id, &r.add_assignee_ids).await?;
    let target_module = match r.module_id.as_deref().filter(|s| !s.is_empty()) {
        Some(m) => {
            let (_, p) = module_project(&store, m).await?;
            if p != project_id {
                return Err(ConnectError::new_invalid_argument(
                    "destination module is in a different project",
                ));
            }
            Some(m.to_string())
        }
        None => None,
    };
    let selected: HashSet<String> = tasks.iter().map(|t| t.pid.to_string()).collect();
    // Moved tasks append after the destination's current last one.
    let mut next_order = match &target_module {
        Some(m) => tasks_for_modules(&store, HashSet::from([m.clone()]))
            .await
            .map_err(internal)?
            .iter()
            .map(|t| t.order + 1)
            .max()
            .unwrap_or(0),
        None => 0,
    };

    let mut saved = Vec::with_capacity(tasks.len());
    let mut failed = Vec::new();
    for t in tasks {
        let id = t.pid.to_string();
        let result: Result<pb::Task, ConnectError> = async {
            let assignees = (!r.add_assignee_ids.is_empty() || !r.remove_assignee_ids.is_empty())
                .then(|| pb::StringList {
                    values: edit_ids(&t.assignee_ids, &r.add_assignee_ids, &r.remove_assignee_ids),
                });
            let labels = (!r.add_label_ids.is_empty() || !r.remove_label_ids.is_empty())
                .then(|| pb::StringList {
                    values: edit_ids(&t.label_ids, &r.add_label_ids, &r.remove_label_ids),
                });
            let edits = status_id.is_some()
                || r.priority.is_some()
                || r.due_date.is_some()
                || assignees.is_some()
                || labels.is_some();
            // A move-only call leaves no empty "updated" entry in the log.
            let mut task = if edits {
                update_task_core(
                    &store,
                    n,
                    &auth,
                    pb::UpdateTaskRequest {
                        id: id.clone(),
                        status_id: status_id.clone(),
                        priority: r.priority,
                        due_date: r.due_date.clone(),
                        assignee_ids: assignees,
                        label_ids: labels,
                        ..Default::default()
                    },
                )
                .await?
            } else {
                to_proto(&t)
            };
            if let Some(m) = target_module.as_ref().filter(|m| **m != t.module_id) {
                match &t.parent_id {
                    // Carried along by its parent's move.
                    Some(p) if selected.contains(p) => {}
                    Some(_) => {
                        return Err(ConnectError::new_failed_precondition(
                            "a subtask moves with its parent",
                        ))
                    }
                    None => {
                        let order = next_order;
                        next_order += 1;
                        task = move_task_core(
                            &store,
                            &auth,
                            pb::MoveTaskRequest { id: id.clone(), module_id: m.clone(), order },
                        )
                        .await?;
                    }
                }
            }
            Ok(task)
        }
        .await;
        match result {
            Ok(task) => saved.push(task),
            Err(e) => failed.push(pb::BulkFailure {
                id,
                message: e.message().unwrap_or("failed").to_string(),
            }),
        }
    }
    // A subtask's module moved with its parent after it was saved above;
    // re-read so every returned row is current.
    if target_module.is_some() {
        for task in saved.iter_mut() {
            if let Ok(pid) = task.id.parse::<i64>() {
                if let Some(t) = load_task(&store, pid).await.map_err(internal)? {
                    *task = to_proto(&t);
                }
            }
        }
    }
    Ok(ConnectResponse::new(pb::BulkUpdateTasksResponse {
        tasks: saved,
        failed,
    }))
}

async fn bulk_delete_tasks(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::BulkDeleteTasksRequest>,
) -> Result<ConnectResponse<pb::BulkDeleteTasksResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let (_project, tasks) = bulk_targets(&store, &auth, &r.task_ids).await?;
    let mut deleted: Vec<String> = Vec::new();
    let mut failed = Vec::new();
    for t in tasks {
        let id = t.pid.to_string();
        // Already removed with a parent deleted earlier in this call.
        if deleted.contains(&id) {
            continue;
        }
        match delete_task_core(&store, &auth, t.pid).await {
            Ok(gone) => deleted.extend(gone),
            Err(e) => failed.push(pb::BulkFailure {
                id,
                message: e.message().unwrap_or("failed").to_string(),
            }),
        }
    }
    Ok(ConnectResponse::new(pb::BulkDeleteTasksResponse {
        deleted_ids: deleted,
        failed,
    }))
}

/// TaskService router; injects the Store as a request extension.
pub fn task_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    type N = Option<Extension<Arc<Notifier>>>;
    TaskServiceBuilder::<()>::new()
        .get_task::<_, (StoreExt, A, ConnectRequest<pb::GetTaskRequest>)>(get_task)
        .list_tasks::<_, (StoreExt, A, ConnectRequest<pb::ListTasksRequest>)>(list_tasks)
        .create_task::<_, (StoreExt, N, A, ConnectRequest<pb::CreateTaskRequest>)>(create_task)
        .update_task::<_, (StoreExt, N, A, ConnectRequest<pb::UpdateTaskRequest>)>(update_task)
        .delete_task::<_, (StoreExt, A, ConnectRequest<pb::DeleteTaskRequest>)>(delete_task)
        .move_task::<_, (StoreExt, A, ConnectRequest<pb::MoveTaskRequest>)>(move_task)
        .bulk_update_tasks::<_, (StoreExt, N, A, ConnectRequest<pb::BulkUpdateTasksRequest>)>(
            bulk_update_tasks,
        )
        .bulk_delete_tasks::<_, (StoreExt, A, ConnectRequest<pb::BulkDeleteTasksRequest>)>(
            bulk_delete_tasks,
        )
        .build()
        .layer(Extension(store))
}
