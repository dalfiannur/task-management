//! Bulk edits: up to 200 tasks of one project in one call, each through the
//! same path as its single-task change (activity, notifications, search).
//! Deleting is two-step: a preview first, then a delete that names how many
//! tasks it expects to remove.

use serde_json::{json, Value};
use transport::api::{
    bulk_delete_preview_core, bulk_delete_tasks_core, bulk_update_tasks_core, get_task_core,
    list_task_statuses_core, module_project, work_pb, BulkDeletePreview,
};

use super::tasks::{flatten, priority_arg, status_target, StatusTarget};
use super::{opt_str, opt_str_list, Ctx, ToolError, ToolMeta};

fn task_ids(args: &Value) -> Result<Vec<String>, ToolError> {
    match opt_str_list(args, "task_ids")? {
        Some(ids) if !ids.is_empty() => Ok(ids),
        _ => Err(ToolError::BadArgs("`task_ids` must be a non-empty array of task ids".into())),
    }
}

fn failures(f: &[work_pb::BulkFailure]) -> Vec<Value> {
    f.iter().map(|f| json!({ "task_id": f.id, "message": f.message })).collect()
}

pub const BULK_UPDATE_TASKS: ToolMeta = ToolMeta {
    name: "bulk_update_tasks",
    description: "Apply the same change to up to 200 tasks of one project: status, priority, \
                  assignees and labels added or removed, due date, or module. Fields not sent \
                  are left as-is. Each task is saved on its own; any that fail are listed in \
                  `failed` and the rest still apply.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "task_ids": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 200 },
                "status": { "type": "string", "description": "A category (todo, in_progress, done, cancelled), meaning its first status, or the name of one of the project's statuses." },
                "priority": { "type": "string", "enum": ["none", "low", "medium", "high", "urgent"] },
                "add_assignee_ids": { "type": "array", "items": { "type": "string" } },
                "remove_assignee_ids": { "type": "array", "items": { "type": "string" } },
                "add_label_ids": { "type": "array", "items": { "type": "string" } },
                "remove_label_ids": { "type": "array", "items": { "type": "string" } },
                "due_date": { "type": ["string", "null"], "description": "yyyy-MM-dd, or null to clear the due date." },
                "module_id": { "type": "string", "description": "Move the tasks to this module of the same project." }
            },
            "required": ["task_ids"]
        })
    },
    handler: |ctx, args| Box::pin(bulk_update_tasks(ctx, args)),
};

pub async fn bulk_update_tasks(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let ids = task_ids(args)?;
    let status_id = match opt_str(args, "status") {
        None => None,
        Some(s) => {
            // The project the core fn will check every task against.
            let t = get_task_core(&ctx.store, &ctx.auth, work_pb::GetTaskRequest { id: ids[0].clone() })
                .await?;
            let project_id = module_project(&ctx.store, &t.module_id).await?.1;
            Some(match status_target(ctx, &project_id, &s).await? {
                StatusTarget::Status(id) => id,
                StatusTarget::Category(c) => {
                    let all = list_task_statuses_core(
                        &ctx.store,
                        &ctx.auth,
                        work_pb::ListTaskStatusesRequest { project_id },
                    )
                    .await?;
                    all.statuses
                        .iter()
                        .find(|st| st.category == c)
                        .map(|st| st.id.clone())
                        .ok_or_else(|| ToolError::Business(format!("the project has no `{s}` status")))?
                }
            })
        }
    };
    let due_date = match args.get("due_date") {
        None => None,
        Some(Value::Null) => Some(String::new()),
        Some(Value::String(s)) if s.is_empty() => {
            return Err(ToolError::BadArgs(
                "`due_date` cannot be an empty string; send null to clear it".into(),
            ))
        }
        Some(Value::String(s)) => Some(s.clone()),
        Some(_) => return Err(ToolError::BadArgs("`due_date` must be yyyy-MM-dd or null".into())),
    };
    let req = work_pb::BulkUpdateTasksRequest {
        task_ids: ids,
        status_id,
        priority: priority_arg(args)?,
        add_assignee_ids: opt_str_list(args, "add_assignee_ids")?.unwrap_or_default(),
        remove_assignee_ids: opt_str_list(args, "remove_assignee_ids")?.unwrap_or_default(),
        add_label_ids: opt_str_list(args, "add_label_ids")?.unwrap_or_default(),
        remove_label_ids: opt_str_list(args, "remove_label_ids")?.unwrap_or_default(),
        due_date,
        module_id: opt_str(args, "module_id"),
    };
    let nothing = req.status_id.is_none()
        && req.priority.is_none()
        && req.add_assignee_ids.is_empty()
        && req.remove_assignee_ids.is_empty()
        && req.add_label_ids.is_empty()
        && req.remove_label_ids.is_empty()
        && req.due_date.is_none()
        && req.module_id.is_none();
    if nothing {
        return Err(ToolError::BadArgs("nothing to change: send at least one field besides `task_ids`".into()));
    }
    let resp = bulk_update_tasks_core(&ctx.store, Some(&ctx.notifier), &ctx.auth, req).await?;
    Ok(json!({
        "updated": resp.tasks.iter().map(flatten).collect::<Vec<_>>(),
        "updated_count": resp.tasks.len(),
        "failed": failures(&resp.failed),
    }))
}

pub const BULK_DELETE_TASKS: ToolMeta = ToolMeta {
    name: "bulk_delete_tasks",
    description: "Delete up to 200 tasks of one project for good, with their subtasks, \
                  comments and logged time. This cannot be undone. Two steps: call without \
                  `confirm_count` to get a preview (nothing is deleted), show it to the user, \
                  then call again with `confirm_count` set to the preview's `total`. A count \
                  that no longer matches deletes nothing.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "task_ids": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 200 },
                "confirm_count": { "type": "integer", "minimum": 1, "description": "The preview's `total`: every task that will be removed, subtasks included." }
            },
            "required": ["task_ids"]
        })
    },
    handler: |ctx, args| Box::pin(bulk_delete_tasks(ctx, args)),
};

fn preview_json(p: &BulkDeletePreview) -> Value {
    json!({
        "tasks": p.tasks.iter().map(|(id, title)| json!({ "id": id, "title": title })).collect::<Vec<_>>(),
        "selected": p.tasks.len(),
        "subtasks": p.subtasks,
        "total": p.total(),
        "logged_minutes": p.logged_minutes,
    })
}

pub async fn bulk_delete_tasks(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let ids = task_ids(args)?;
    let confirm = match args.get("confirm_count") {
        None | Some(Value::Null) => None,
        Some(v) => Some(v.as_i64().filter(|n| *n >= 1).ok_or_else(|| {
            ToolError::BadArgs("`confirm_count` must be a whole number, the preview's `total`".into())
        })?),
    };
    let preview = bulk_delete_preview_core(&ctx.store, &ctx.auth, &ids).await?;
    let Some(confirm) = confirm else {
        return Ok(json!({
            "deleted": false,
            "preview": preview_json(&preview),
            "next": format!(
                "Nothing was deleted. To delete these {} task(s) for good, call again with confirm_count = {}.",
                preview.total(),
                preview.total()
            ),
        }));
    };
    if confirm != preview.total() {
        return Err(ToolError::Business(format!(
            "nothing deleted: these ids now remove {} task(s), not {confirm}. Check the preview again \
             (call without confirm_count) before confirming.",
            preview.total()
        )));
    }
    let resp = bulk_delete_tasks_core(&ctx.store, &ctx.auth, work_pb::BulkDeleteTasksRequest { task_ids: ids })
        .await?;
    Ok(json!({
        "deleted": true,
        "deleted_ids": resp.deleted_ids,
        "deleted_count": resp.deleted_ids.len(),
        "failed": failures(&resp.failed),
    }))
}
