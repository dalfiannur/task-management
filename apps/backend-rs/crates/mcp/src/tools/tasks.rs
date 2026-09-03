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

/// The inverse of `priority_label`, validated the same way `list_tasks`'
/// `status` filter is: absent (the argument wasn't supplied) is `Ok(None)`,
/// and both `create_task_core`/`update_task_core` already treat that as
/// "no priority"/"unchanged" on their own. A *present but unrecognized*
/// label — a typo like "critial" — is rejected here instead of being
/// smuggled through as `0` (`TASK_PRIORITY_UNSPECIFIED`): `update_task_core`
/// happens to reject `0` on its own re-parse, but `create_task_core` treats
/// unspecified as "no priority" and would silently create the task anyway.
/// Validating at this boundary makes the same typo fail the same way through
/// both tools, rather than relying on one core fn's incidental behavior.
fn priority_arg(args: &Value) -> Result<Option<i32>, ToolError> {
    match opt_str(args, "priority") {
        None => Ok(None),
        Some(s) => domain::task::TaskPriority::parse(&s)
            .map(|p| Some(p.to_proto()))
            .ok_or_else(|| {
                ToolError::BadArgs(format!(
                    "`priority` must be one of none, low, medium, high, urgent (got `{s}`)"
                ))
            }),
    }
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

/// `update_task`'s re-parent argument, mapped onto the proto's `StringList`
/// wrapper: absent = unchanged, `null` = detach to top level, a string = that
/// parent. Re-parenting needs all three states, which is why the proto uses a
/// list here rather than an `optional string` (see `UpdateTaskRequest`).
///
/// `null` carries the detach signal rather than an empty string because
/// `opt_str` reads `""` as "not supplied" everywhere else in this file. An
/// empty string would therefore mean "unchanged" — precisely the outcome a
/// caller asking to detach did not want, and a silent one. It is refused with
/// a message naming the alternative instead.
fn parent_arg(args: &Value) -> Result<Option<work_pb::StringList>, ToolError> {
    match args.get("parent_id") {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(work_pb::StringList { values: Vec::new() })),
        Some(Value::String(s)) if s.is_empty() => Err(ToolError::BadArgs(
            "`parent_id` cannot be an empty string; send null to detach the task to top level"
                .into(),
        )),
        Some(Value::String(s)) => Ok(Some(work_pb::StringList {
            values: vec![s.clone()],
        })),
        Some(_) => Err(ToolError::BadArgs(
            "`parent_id` must be a task id string, or null to detach".into(),
        )),
    }
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
    // Unlike `create_task`/`update_task`, a bad `status` here never reaches a
    // core fn to be rejected — it's just a filter predicate, so a typo like
    // "archived" would otherwise silently match nothing. The model would then
    // read that as "no such tasks" rather than "bad filter value", which is
    // exactly the failure `limit_arg`'s doc comment refuses to allow for
    // `limit`.
    let status = match opt_str(args, "status") {
        Some(s) if domain::task::TaskStatus::parse(&s).is_none() => {
            return Err(ToolError::BadArgs(format!(
                "`status` must be one of todo, in_progress, done, cancelled (got `{s}`)"
            )))
        }
        other => other,
    };
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
    description: "Create a new task in a module, or a subtask of an existing task \
                  by passing `parent_id`. Assignees must be project members. Record \
                  a fix or follow-up as a subtask of the task it belongs to, so the \
                  history stays attached to the work it changed.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "module_id": { "type": "string", "description": "Module the task goes in. Still required with `parent_id`, but then it only picks the project: a subtask always lands in its parent's module." },
                "title": { "type": "string" },
                "description": { "type": "string" },
                "parent_id": { "type": "string", "description": "Make this a subtask of that task. The parent must be in the same project and must not itself be a subtask — nesting is one level deep." },
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
        // `priority_arg` already rejects a misspelled priority; `0` here only
        // ever means "not supplied", which `create_task_core` treats as no
        // priority.
        priority: priority_arg(args)?.unwrap_or(0),
        start_date: opt_str(args, "start_date"),
        due_date: opt_str(args, "due_date"),
        assignee_ids: opt_str_list(args, "assignee_ids")?.unwrap_or_default(),
        label_ids: Vec::new(),
        // `create_task_core` owns the rules — parent exists, same project, not
        // itself a subtask — and overrides `module_id` with the parent's, so
        // there is nothing left to check here.
        parent_id: opt_str(args, "parent_id"),
    };
    let t = create_task_core(&ctx.store, Some(&ctx.notifier), &ctx.auth, req).await?;
    Ok(flatten(&t))
}

pub const UPDATE_TASK: ToolMeta = ToolMeta {
    name: "update_task",
    description: "Update a subset of a task's fields. Fields not sent are left as-is. \
                  `parent_id` re-parents the task: a task id makes it a subtask of that \
                  task, null detaches it back to top level, and omitting it leaves the \
                  task where it is.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "task_id": { "type": "string" },
                "title": { "type": "string" },
                "description": { "type": "string" },
                "parent_id": { "type": ["string", "null"], "description": "Task id to become a subtask of, or null to detach to top level. Omit to leave the parent unchanged. The parent must be in the same project and must not itself be a subtask." },
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
        // Validated up front rather than left to `update_task_core`'s own
        // re-parse: it happens to reject an invalid code, but that's a more
        // fragile guarantee to lean on than checking at the boundary the way
        // `status` above (and `list_tasks`' status filter) already do.
        priority: priority_arg(args)?,
        start_date: opt_str(args, "start_date"),
        due_date: opt_str(args, "due_date"),
        assignee_ids: opt_str_list(args, "assignee_ids")?
            .map(|values| work_pb::StringList { values }),
        label_ids: None,
        blocked_by_ids: None,
        parent_id_set: parent_arg(args)?,
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
