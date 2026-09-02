//! Task tools. Every tool calls the same core fn as the UI, then flattens the
//! proto result into model-friendly JSON — enums become strings, and long
//! descriptions are truncated.

use serde_json::{json, Value};
use transport::api::{
    create_task_core, get_task_core, list_tasks_core, module_project, move_task_core,
    update_task_core, work_pb,
};

use super::{limit_arg, opt_str, opt_str_list, str_arg, truncate, Ctx, ToolError, ToolMeta};

/// Proto `TaskStatus` code → model-readable label. `pub(crate)` because
/// Task 12's `my_tasks` tool flattens `Task`s the same way this one does.
pub(crate) fn status_label(v: i32) -> &'static str {
    domain::task::TaskStatus::from_proto(v)
        .unwrap_or(domain::task::TaskStatus::Todo)
        .as_str()
}

/// Proto `TaskPriority` code → model-readable label.
fn priority_label(v: i32) -> &'static str {
    domain::task::TaskPriority::from_proto(v)
        .unwrap_or(domain::task::TaskPriority::None)
        .as_str()
}

/// The inverse of `priority_label`: a model-supplied label → the proto code.
/// An absent or unrecognized label becomes `0` (`TASK_PRIORITY_UNSPECIFIED`),
/// which `create_task_core` already treats as "no priority" — so this never
/// needs to reject anything itself; `update_task_core` rejects `0` on its own
/// (see `status_value` below for why that matters there).
fn priority_value(s: Option<&str>) -> i32 {
    s.and_then(domain::task::TaskPriority::parse)
        .map(|p| p.to_proto())
        .unwrap_or(0)
}

/// The inverse of `status_label`, for `update_task`'s optional `status` field.
/// Unlike priority, `0` is never a valid status to send: an unrecognized label
/// is deliberately mapped to it anyway (rather than silently dropped) so
/// `update_task_core`'s own `TaskStatus::from_proto` check rejects it as
/// "invalid status" instead of the tool quietly leaving status unchanged.
fn status_value(s: &str) -> i32 {
    domain::task::TaskStatus::parse(s)
        .map(|st| st.to_proto())
        .unwrap_or(0)
}

/// Proto `Task` → flat JSON. `snake_case` field names to match the tool
/// argument names; the model doesn't need to translate between two
/// conventions. `pub(crate)` for the same reason as `status_label`.
pub(crate) fn flatten(t: &work_pb::Task) -> Value {
    json!({
        "id": t.id,
        "title": t.title,
        "description": truncate(&t.description),
        "status": status_label(t.status),
        "priority": priority_label(t.priority),
        "module_id": t.module_id,
        "assignee_ids": t.assignee_ids,
        "start_date": t.start_date,
        "due_date": t.due_date,
        "parent_id": t.parent_id,
    })
}

pub const LIST_TASKS: ToolMeta = ToolMeta {
    name: "list_tasks",
    description: "List tasks in a project or module. Either project_id or \
                  module_id is required. Use list_projects first if you don't \
                  know the id yet.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "module_id": { "type": "string" },
                "assignee_id": { "type": "string" },
                "status": { "type": "string", "enum": ["todo", "in_progress", "done", "cancelled"] },
                "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
            }
        })
    },
    handler: |ctx, args| Box::pin(list_tasks(ctx, args)),
};

pub async fn list_tasks(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let project_id = opt_str(args, "project_id");
    let module_id = opt_str(args, "module_id");
    // Without one of these, this request would scan the entire database.
    if project_id.is_none() && module_id.is_none() {
        return Err(ToolError::BadArgs(
            "either `project_id` or `module_id` is required".into(),
        ));
    }
    // `ListTasksRequest.project_id` is required by the proto even though this
    // tool lets the model supply only a module_id — resolve it through the
    // same module→project lookup every other task handler uses.
    let project_id = match project_id {
        Some(p) => p,
        None => module_project(&ctx.store, module_id.as_ref().unwrap()).await?.1,
    };
    let req = work_pb::ListTasksRequest {
        project_id,
        module_id: module_id.clone(),
    };
    let resp = list_tasks_core(&ctx.store, &ctx.auth, req).await?;
    let status = opt_str(args, "status");
    let assignee = opt_str(args, "assignee_id");
    let rows: Vec<Value> = resp
        .tasks
        .iter()
        .filter(|t| status.as_deref().is_none_or(|s| status_label(t.status) == s))
        .filter(|t| assignee.as_deref().is_none_or(|a| t.assignee_ids.iter().any(|x| x == a)))
        .take(limit_arg(args)?)
        .map(flatten)
        .collect();
    // `rows` is moved into the object below, so its length has to be read
    // first rather than inline.
    let count = rows.len();
    Ok(json!({ "tasks": rows, "count": count }))
}

pub const GET_TASK: ToolMeta = ToolMeta {
    name: "get_task",
    description: "Fetch a single task with its description, assignees, dates, and status.",
    schema: || {
        json!({
            "type": "object",
            "properties": { "task_id": { "type": "string" } },
            "required": ["task_id"]
        })
    },
    handler: |ctx, args| Box::pin(get_task(ctx, args)),
};

pub async fn get_task(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = work_pb::GetTaskRequest { id: str_arg(args, "task_id")? };
    Ok(flatten(&get_task_core(&ctx.store, &ctx.auth, req).await?))
}

pub const CREATE_TASK: ToolMeta = ToolMeta {
    name: "create_task",
    description: "Create a new task in a module. Assignees must be project members.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "module_id": { "type": "string" },
                "title": { "type": "string" },
                "description": { "type": "string" },
                "priority": { "type": "string", "enum": ["none", "low", "medium", "high", "urgent"] },
                "start_date": { "type": "string", "description": "ISO-8601 date, yyyy-MM-dd" },
                "due_date": { "type": "string", "description": "ISO-8601 date, yyyy-MM-dd" },
                "assignee_ids": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["module_id", "title"]
        })
    },
    handler: |ctx, args| Box::pin(create_task(ctx, args)),
};

pub async fn create_task(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = work_pb::CreateTaskRequest {
        module_id: str_arg(args, "module_id")?,
        title: str_arg(args, "title")?,
        description: opt_str(args, "description"),
        // Always UNSPECIFIED: `create_task_core` defaults it to Todo, and this
        // tool doesn't expose an initial status to the model.
        status: 0,
        priority: priority_value(opt_str(args, "priority").as_deref()),
        start_date: opt_str(args, "start_date"),
        due_date: opt_str(args, "due_date"),
        assignee_ids: opt_str_list(args, "assignee_ids")?.unwrap_or_default(),
        label_ids: Vec::new(),
        parent_id: None,
    };
    let t = create_task_core(&ctx.store, Some(&ctx.notifier), &ctx.auth, req).await?;
    Ok(flatten(&t))
}

pub const UPDATE_TASK: ToolMeta = ToolMeta {
    name: "update_task",
    description: "Update a subset of a task's fields. Fields not sent are left as-is.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "task_id": { "type": "string" },
                "title": { "type": "string" },
                "description": { "type": "string" },
                "status": { "type": "string", "enum": ["todo", "in_progress", "done", "cancelled"] },
                "priority": { "type": "string", "enum": ["none", "low", "medium", "high", "urgent"] },
                "start_date": { "type": "string", "description": "ISO-8601 date, yyyy-MM-dd" },
                "due_date": { "type": "string", "description": "ISO-8601 date, yyyy-MM-dd" },
                "assignee_ids": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["task_id"]
        })
    },
    handler: |ctx, args| Box::pin(update_task(ctx, args)),
};

pub async fn update_task(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = work_pb::UpdateTaskRequest {
        id: str_arg(args, "task_id")?,
        title: opt_str(args, "title"),
        description: opt_str(args, "description"),
        status: opt_str(args, "status").map(|s| status_value(&s)),
        priority: opt_str(args, "priority").map(|s| priority_value(Some(&s))),
        start_date: opt_str(args, "start_date"),
        due_date: opt_str(args, "due_date"),
        assignee_ids: opt_str_list(args, "assignee_ids")?
            .map(|values| work_pb::StringList { values }),
        label_ids: None,
        blocked_by_ids: None,
        parent_id_set: None,
    };
    let t = update_task_core(&ctx.store, Some(&ctx.notifier), &ctx.auth, req).await?;
    Ok(flatten(&t))
}

pub const MOVE_TASK: ToolMeta = ToolMeta {
    name: "move_task",
    description: "Move a task to another module in the same project.",
    schema: || {
        json!({
            "type": "object",
            "properties": { "task_id": { "type": "string" }, "module_id": { "type": "string" } },
            "required": ["task_id", "module_id"]
        })
    },
    handler: |ctx, args| Box::pin(move_task(ctx, args)),
};

pub async fn move_task(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = work_pb::MoveTaskRequest {
        id: str_arg(args, "task_id")?,
        module_id: str_arg(args, "module_id")?,
        // This tool doesn't expose a target position to the model, so the
        // task always lands at the top of the destination module; the human
        // UI's drag-and-drop is the place to fine-tune order.
        order: 0,
    };
    let t = move_task_core(&ctx.store, &ctx.auth, req).await?;
    Ok(flatten(&t))
}
