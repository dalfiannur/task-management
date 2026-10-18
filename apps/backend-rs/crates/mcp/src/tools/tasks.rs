//! Task tools. Every tool calls the same core fn as the UI, then flattens the
//! proto result into model-friendly JSON — enums become strings, and long
//! descriptions are truncated.

use serde_json::{json, Value};
use transport::api::{
    create_task_core, get_task_core, list_tasks_core, module_project, move_task_core,
    log_time_core, status_by_name, time_pb, update_task_core, work_pb,
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

/// `estimate_minutes`: absent = not sent; otherwise a whole number of minutes
/// (0 clears on update). Range-checked by the core fn; a non-integer is
/// refused here rather than silently dropped.
fn estimate_arg(args: &Value) -> Result<Option<i32>, ToolError> {
    match args.get("estimate_minutes") {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_i64()
            .and_then(|n| i32::try_from(n).ok())
            .map(Some)
            .ok_or_else(|| {
                ToolError::BadArgs("`estimate_minutes` must be a whole number of minutes".into())
            }),
    }
}

const STATUS_HELP: &str = "a category (todo, in_progress, done, cancelled) or the \
                           name of one of the project's statuses";

/// What a `status` argument names in `project_id`: a category (the core fn
/// then picks that category's first status) or, failing that, one of the
/// project's own statuses by name. Validated at this boundary because
/// `create_task_core` reads an unrecognized status as "unspecified" and
/// silently defaults it to Todo, so a typo like "in-progress" would create
/// the task in the wrong state instead of failing.
enum StatusTarget {
    Category(i32),
    Status(String),
}

async fn status_target(ctx: &Ctx, project_id: &str, s: &str) -> Result<StatusTarget, ToolError> {
    if let Some(c) = domain::task::TaskStatus::parse(s) {
        return Ok(StatusTarget::Category(c.to_proto()));
    }
    match status_by_name(&ctx.store, project_id, s).await? {
        Some((id, _)) => Ok(StatusTarget::Status(id)),
        None => Err(ToolError::BadArgs(format!(
            "`status` must be {STATUS_HELP} (got `{s}`)"
        ))),
    }
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
        "status_name": t.status_name,
        "estimate_minutes": t.estimate_minutes,
        "logged_minutes": t.logged_minutes,
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
                "status": { "type": "string", "description": "Filter: a category (todo, in_progress, done, cancelled) matches every status in it; otherwise the name of one of the project's statuses." },
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
        project_id: project_id.clone(),
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
        Some(s) => Some(status_target(ctx, &project_id, &s).await?),
        None => None,
    };
    let assignee = opt_str(args, "assignee_id");
    let rows: Vec<Value> = resp
        .tasks
        .iter()
        .filter(|t| match &status {
            None => true,
            Some(StatusTarget::Category(c)) => t.status == *c,
            Some(StatusTarget::Status(id)) => &t.status_id == id,
        })
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
                "status": { "type": "string", "description": "Initial status: a category (todo, in_progress, done, cancelled) or the name of one of the project's statuses. Omit to start the task in the project's first todo status." },
                "priority": { "type": "string", "enum": ["none", "low", "medium", "high", "urgent"] },
                "start_date": { "type": "string", "description": "ISO-8601 date, yyyy-MM-dd" },
                "due_date": { "type": "string", "description": "ISO-8601 date, yyyy-MM-dd" },
                "estimate_minutes": { "type": "integer", "minimum": 0, "maximum": 60000, "description": "Estimated effort in minutes (e.g. 90 for 1h 30m). Omit if unknown." },
                "assignee_ids": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["module_id", "title"]
        })
    },
    handler: |ctx, args| Box::pin(create_task(ctx, args)),
};

pub async fn create_task(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let module_id = str_arg(args, "module_id")?;
    let (status, status_id) = match opt_str(args, "status") {
        None => (0, None),
        Some(s) => {
            let project_id = module_project(&ctx.store, &module_id).await?.1;
            match status_target(ctx, &project_id, &s).await? {
                StatusTarget::Category(c) => (c, None),
                StatusTarget::Status(id) => (0, Some(id)),
            }
        }
    };
    let req = work_pb::CreateTaskRequest {
        module_id,
        title: str_arg(args, "title")?,
        description: opt_str(args, "description"),
        // `status_target` already rejects a misspelled status; `0` here only
        // ever means "not supplied" (or a named status, which wins), which
        // `create_task_core` defaults to Todo.
        status,
        status_id,
        estimate_minutes: estimate_arg(args)?,
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
                "status": { "type": "string", "description": "A category (todo, in_progress, done, cancelled) — its first status, unless the task is already in it — or the name of one of the project's statuses." },
                "priority": { "type": "string", "enum": ["none", "low", "medium", "high", "urgent"] },
                "start_date": { "type": "string", "description": "ISO-8601 date, yyyy-MM-dd" },
                "due_date": { "type": "string", "description": "ISO-8601 date, yyyy-MM-dd" },
                "estimate_minutes": { "type": "integer", "minimum": 0, "maximum": 60000, "description": "Estimated effort in minutes; 0 removes the estimate." },
                "assignee_ids": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["task_id"]
        })
    },
    handler: |ctx, args| Box::pin(update_task(ctx, args)),
};

pub async fn update_task(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let id = str_arg(args, "task_id")?;
    let (status, status_id) = match opt_str(args, "status") {
        None => (None, None),
        Some(s) => {
            // Member-gated read: the task's project scopes the status names.
            let t = get_task_core(&ctx.store, &ctx.auth, work_pb::GetTaskRequest { id: id.clone() })
                .await?;
            let project_id = module_project(&ctx.store, &t.module_id).await?.1;
            match status_target(ctx, &project_id, &s).await? {
                StatusTarget::Category(c) => (Some(c), None),
                StatusTarget::Status(sid) => (None, Some(sid)),
            }
        }
    };
    let req = work_pb::UpdateTaskRequest {
        id,
        title: opt_str(args, "title"),
        description: opt_str(args, "description"),
        status,
        status_id,
        estimate_minutes: estimate_arg(args)?,
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

pub const LOG_TIME: ToolMeta = ToolMeta {
    name: "log_time",
    description: "Record time spent on a task, as your own time entry. Use it after \
                  finishing a piece of work so the task's logged time and the timesheet \
                  stay accurate.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "task_id": { "type": "string" },
                "minutes": { "type": "integer", "minimum": 1, "maximum": 1440, "description": "Minutes spent (e.g. 90 for 1h 30m)." },
                "date": { "type": "string", "description": "Day the work counts for, yyyy-MM-dd. Defaults to today (UTC)." },
                "note": { "type": "string", "description": "What was done, briefly." }
            },
            "required": ["task_id", "minutes"]
        })
    },
    handler: |ctx, args| Box::pin(log_time(ctx, args)),
};

pub async fn log_time(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let minutes = args
        .get("minutes")
        .and_then(Value::as_i64)
        .and_then(|n| i32::try_from(n).ok())
        .ok_or_else(|| ToolError::BadArgs("`minutes` must be a whole number".into()))?;
    let e = log_time_core(
        &ctx.store,
        &ctx.auth,
        time_pb::LogTimeRequest {
            task_id: str_arg(args, "task_id")?,
            minutes,
            date: opt_str(args, "date"),
            note: opt_str(args, "note"),
        },
    )
    .await?;
    Ok(json!({
        "id": e.id,
        "task_id": e.task_id,
        "date": e.date,
        "minutes": e.minutes,
        "note": e.note,
    }))
}
