//! TemplateService: task templates within a project. Members list, save and
//! use them; the author, the project owner or an admin deletes one.

use std::collections::HashSet;
use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::task::TaskPriority;
use domain::template::{template_name_ok, TemplateSubtask, MAX_TEMPLATE_SUBTASKS};
use persistence::Store;

use super::record::{
    self as tpl, load_template, subtask_titles, templates_for, NewTemplate, TemplateRecord,
};
use crate::notifications::Notifier;
use crate::sedjiwa::tasks::templates::v1 as pb;
use crate::sedjiwa::tasks::templates::v1::template_service_connect::TemplateServiceBuilder;
use crate::sedjiwa::tasks::work::v1 as work_pb;
use crate::work::task_record::load_task;
use crate::work::task_service::{create_task_core, module_project};
use crate::work::{
    internal, parse_pid, require_auth, require_member, require_owner_or_admin, task_project_id,
    StoreExt,
};

fn to_proto(t: &TemplateRecord) -> pb::TaskTemplate {
    pb::TaskTemplate {
        id: t.pid.to_string(),
        project_id: t.project_id.clone(),
        name: t.name.clone(),
        title: t.title.clone(),
        description: t.description.clone(),
        priority: TaskPriority::parse(&t.priority).unwrap_or(TaskPriority::None).to_proto(),
        estimate_minutes: t.estimate_minutes,
        label_ids: t.label_ids.clone(),
        subtasks: t
            .subtasks
            .iter()
            .map(|s| pb::TemplateSubtask { title: s.title.clone() })
            .collect(),
        created_by: t.created_by.clone(),
        created_at: t.created_at.clone(),
    }
}

async fn require_template(store: &Store, id: &str) -> Result<TemplateRecord, ConnectError> {
    load_template(store, parse_pid(id)?)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("template not found"))
}

async fn list_task_templates(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListTaskTemplatesRequest>,
) -> Result<ConnectResponse<pb::ListTaskTemplatesResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_member(&store, &r.project_id, &auth).await?;
    let templates = templates_for(&store, &r.project_id).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::ListTaskTemplatesResponse {
        templates: templates.iter().map(to_proto).collect(),
    }))
}

async fn save_task_template(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::SaveTaskTemplateRequest>,
) -> Result<ConnectResponse<pb::TaskTemplate>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let name = r.name.trim();
    if !template_name_ok(name) {
        return Err(ConnectError::new_invalid_argument("name must be 1–80 characters"));
    }
    let project = task_project_id(&store, &r.task_id)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("task not found"))?;
    require_member(&store, &project, &auth).await?;
    let t = load_task(&store, parse_pid(&r.task_id)?)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("task not found"))?;
    let subtasks: Vec<TemplateSubtask> = subtask_titles(&store, &r.task_id)
        .await
        .map_err(internal)?
        .into_iter()
        .take(MAX_TEMPLATE_SUBTASKS)
        .map(|title| TemplateSubtask { title })
        .collect();
    let now = crate::timelog::record::now_iso();
    let pid = tpl::create_template(
        &store,
        NewTemplate {
            project_id: &project,
            name,
            title: &t.title,
            description: &t.description,
            priority: t.priority.as_str(),
            estimate_minutes: t.estimate_minutes,
            label_ids: t.label_ids.clone(),
            subtasks,
            created_by: &auth.id,
            created_at: &now,
        },
    )
    .await
    .map_err(internal)?;
    let saved = require_template(&store, &pid.to_string()).await?;
    Ok(ConnectResponse::new(to_proto(&saved)))
}

async fn delete_task_template(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::DeleteTaskTemplateRequest>,
) -> Result<ConnectResponse<pb::DeleteTaskTemplateResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let t = require_template(&store, &r.id).await?;
    require_member(&store, &t.project_id, &auth).await?;
    if t.created_by != auth.id {
        require_owner_or_admin(&store, &t.project_id, &auth).await?;
    }
    tpl::delete_template(&store, t.pid).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::DeleteTaskTemplateResponse { ok: true }))
}

/// Labels of `project_id` that still exist, from `ids`.
async fn live_labels(store: &Store, project_id: &str, ids: &[String]) -> anyhow::Result<Vec<String>> {
    let live: HashSet<String> = sqlx::query_scalar(
        "SELECT pid::text FROM cmp_labelinfo WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_all(store.pool())
    .await?
    .into_iter()
    .collect();
    Ok(ids.iter().filter(|l| live.contains(*l)).cloned().collect())
}

async fn create_task_from_template(
    Extension(store): StoreExt,
    notifier: Option<Extension<Arc<Notifier>>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CreateTaskFromTemplateRequest>,
) -> Result<ConnectResponse<work_pb::Task>, ConnectError> {
    let auth = require_auth(user)?;
    let notifier = notifier.map(|Extension(n)| n);
    let ConnectRequest(r) = req;
    let t = require_template(&store, &r.template_id).await?;
    require_member(&store, &t.project_id, &auth).await?;
    let (_mpid, module_project_id) = module_project(&store, &r.module_id).await?;
    if module_project_id != t.project_id {
        return Err(ConnectError::new_invalid_argument(
            "the module is not in the template's project",
        ));
    }
    let labels = live_labels(&store, &t.project_id, &t.label_ids).await.map_err(internal)?;
    let title = r
        .title
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| t.title.clone());
    let parent = create_task_core(
        &store,
        notifier.as_ref(),
        &auth,
        work_pb::CreateTaskRequest {
            module_id: r.module_id.clone(),
            title,
            description: Some(t.description.clone()),
            priority: TaskPriority::parse(&t.priority).unwrap_or(TaskPriority::None).to_proto(),
            due_date: r.due_date.filter(|s| !s.is_empty()),
            assignee_ids: r.assignee_ids,
            label_ids: labels,
            estimate_minutes: t.estimate_minutes,
            ..Default::default()
        },
    )
    .await?;
    for sub in &t.subtasks {
        let title = &sub.title;
        create_task_core(
            &store,
            notifier.as_ref(),
            &auth,
            work_pb::CreateTaskRequest {
                module_id: r.module_id.clone(),
                title: title.clone(),
                parent_id: Some(parent.id.clone()),
                ..Default::default()
            },
        )
        .await?;
    }
    // Re-read so the reply reflects the subtasks (and any counts on them).
    let fresh = load_task(&store, parse_pid(&parent.id)?)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("task not found"))?;
    Ok(ConnectResponse::new(crate::work::task_record::to_proto(&fresh)))
}

/// TemplateService router; injects the Store as a request extension.
pub fn template_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    type N = Option<Extension<Arc<Notifier>>>;
    TemplateServiceBuilder::<()>::new()
        .list_task_templates::<_, (StoreExt, A, ConnectRequest<pb::ListTaskTemplatesRequest>)>(list_task_templates)
        .save_task_template::<_, (StoreExt, A, ConnectRequest<pb::SaveTaskTemplateRequest>)>(save_task_template)
        .delete_task_template::<_, (StoreExt, A, ConnectRequest<pb::DeleteTaskTemplateRequest>)>(delete_task_template)
        .create_task_from_template::<_, (StoreExt, N, A, ConnectRequest<pb::CreateTaskFromTemplateRequest>)>(
            create_task_from_template,
        )
        .build()
        .layer(Extension(store))
}
