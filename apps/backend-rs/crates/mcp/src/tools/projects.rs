//! Navigation tools: project and module. These are what the model uses to
//! find an id before touching a task — without them, `create_task` has no
//! `module_id` to work with, and the model's only option is guessing.

use serde_json::{json, Value};
use transport::api::{
    create_module_core, delete_module_core, get_project_core, list_modules_core,
    list_projects_core, module_task_count, project_pb, update_module_core, work_pb,
};

use super::{limit_arg, opt_str, str_arg, truncate, Ctx, ToolError, ToolMeta};

/// Proto `ProjectStatus` code → model-readable label, the project analogue of
/// `tasks::status_label`. A raw wire integer in tool output would break the
/// "enums as strings" rule every other tool follows.
fn status_label(v: i32) -> &'static str {
    domain::project::ProjectStatus::from_proto(v)
        .map(domain::project::ProjectStatus::as_str)
        // `from_proto` returns `None` for any unrecognised code, not only
        // UNSPECIFIED(0) — a project row always carries a real status once
        // created, but a label is still owed to the model rather than a
        // panic or a bare `null`.
        .unwrap_or("unspecified")
}

pub const LIST_PROJECTS: ToolMeta = ToolMeta {
    name: "list_projects",
    description: "List projects the caller is a member of (admins see all). \
                  Call this first when you don't know a project id yet — its \
                  results feed list_modules and list_tasks.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
            }
        })
    },
    handler: |ctx, args| Box::pin(list_projects(ctx, args)),
};

pub async fn list_projects(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    // `ListProjectsRequest.limit` is the server-side page size (its own
    // default is 12, not this tool's 50) — passing the parsed `limit`
    // through is what makes the tool's cap the one that actually applies,
    // rather than silently capping every call at 12 regardless of what the
    // model asked for.
    let req = project_pb::ListProjectsRequest {
        status: Vec::new(),
        search: None,
        page: 1,
        limit: limit_arg(args)? as u32,
    };
    let resp = list_projects_core(&ctx.store, &ctx.auth, req).await?;
    let rows: Vec<Value> = resp
        .projects
        .iter()
        .map(|p| json!({ "id": p.id, "name": p.name, "status": status_label(p.status) }))
        .collect();
    let count = rows.len();
    Ok(json!({ "projects": rows, "count": count, "total": resp.total }))
}

pub const GET_PROJECT: ToolMeta = ToolMeta {
    name: "get_project",
    description: "Fetch one project's details: description, status, dates, \
                  and owner. Requires the caller to be a member (or admin).",
    schema: || {
        json!({
            "type": "object",
            "properties": { "project_id": { "type": "string" } },
            "required": ["project_id"]
        })
    },
    handler: |ctx, args| Box::pin(get_project(ctx, args)),
};

pub async fn get_project(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = project_pb::GetProjectRequest {
        id: str_arg(args, "project_id")?,
    };
    let p = get_project_core(&ctx.store, &ctx.auth, req).await?;
    Ok(json!({
        "id": p.id,
        "name": p.name,
        "description": truncate(p.description.as_deref().unwrap_or_default()),
        "status": status_label(p.status),
        "owner_id": p.owner_id,
        "start_date": p.start_date,
        "end_date": p.end_date,
    }))
}

pub const LIST_MODULES: ToolMeta = ToolMeta {
    name: "list_modules",
    description: "List the modules (task groups/columns) inside a project. \
                  create_task needs a module_id, not a project_id — call this \
                  after list_projects to find one. Project owners and admins \
                  can shape modules with create_module / update_module / \
                  delete_module.",
    // Deliberately no `limit` here, unlike every other list tool: modules are
    // kanban columns — human-authored project structure, not a growing feed
    // of records — so a project's module count stays naturally small and a
    // cap would protect against a page size that never actually shows up.
    // (Contrast `list_comments` in Task 13, which does declare one — comment
    // threads genuinely do grow.)
    schema: || {
        json!({
            "type": "object",
            "properties": { "project_id": { "type": "string" } },
            "required": ["project_id"]
        })
    },
    handler: |ctx, args| Box::pin(list_modules(ctx, args)),
};

pub async fn list_modules(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let project_id = str_arg(args, "project_id")?;
    let req = work_pb::ListModulesRequest {
        project_id: project_id.clone(),
    };
    let resp = list_modules_core(&ctx.store, &ctx.auth, req).await?;
    let rows: Vec<Value> = resp
        .modules
        .iter()
        .map(|m| {
            json!({
                "id": m.id,
                "name": m.name,
                "description": truncate(m.description.as_deref().unwrap_or_default()),
                "order": m.order,
                // `Module` carries no `project_id` field of its own (it's
                // derived from the entity's `ModuleProjectRef` component,
                // which `to_proto` doesn't expose) — echo the id every
                // returned module actually belongs to instead.
                "project_id": project_id,
            })
        })
        .collect();
    let count = rows.len();
    Ok(json!({ "modules": rows, "count": count }))
}

/// One module as every module tool returns it — the same row shape
/// `list_modules` emits, so a model can treat a create/update result and a
/// list entry interchangeably.
fn module_row(m: &work_pb::Module, project_id: &str) -> Value {
    json!({
        "id": m.id,
        "name": m.name,
        "description": truncate(m.description.as_deref().unwrap_or_default()),
        "order": m.order,
        // `Module` carries no `project_id` on the wire (see `list_modules`).
        "project_id": project_id,
    })
}

/// A module's project id, resolved through `list_modules`' project rather
/// than a new lookup: `UpdateModuleRequest`/`DeleteModuleRequest` take only a
/// module id, and the returned `Module` doesn't say which project it's in.
async fn project_of_module(ctx: &Ctx, module_id: &str) -> Result<String, ToolError> {
    let (_, project_id) = transport::api::module_project(&ctx.store, module_id).await?;
    Ok(project_id)
}

pub const CREATE_MODULE: ToolMeta = ToolMeta {
    name: "create_module",
    description: "Create a module (task group/column) in a project. It is \
                  appended after the existing modules. Only the project owner \
                  or an admin may do this.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "name": { "type": "string" },
                "description": { "type": "string" }
            },
            "required": ["project_id", "name"]
        })
    },
    handler: |ctx, args| Box::pin(create_module(ctx, args)),
};

pub async fn create_module(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let project_id = str_arg(args, "project_id")?;
    let req = work_pb::CreateModuleRequest {
        project_id: project_id.clone(),
        name: str_arg(args, "name")?,
        description: opt_str(args, "description"),
    };
    let m = create_module_core(&ctx.store, &ctx.auth, req).await?;
    Ok(module_row(&m, &project_id))
}

pub const UPDATE_MODULE: ToolMeta = ToolMeta {
    name: "update_module",
    description: "Rename or re-describe a module. Fields not sent are left \
                  as-is; send description as an empty string to clear it. \
                  Only the project owner or an admin may do this.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "module_id": { "type": "string" },
                "name": { "type": "string" },
                "description": { "type": "string", "description": "Empty string clears the description; omit to leave it unchanged." }
            },
            "required": ["module_id"]
        })
    },
    handler: |ctx, args| Box::pin(update_module(ctx, args)),
};

pub async fn update_module(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let module_id = str_arg(args, "module_id")?;
    // Not `opt_str`: that reads `""` as "not supplied", and here an empty
    // string is the one way to clear the description (the UI does the same).
    let description = match args.get("description") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.clone()),
        Some(_) => return Err(ToolError::BadArgs("`description` must be a string".into())),
    };
    let req = work_pb::UpdateModuleRequest {
        id: module_id.clone(),
        name: opt_str(args, "name"),
        description,
    };
    let m = update_module_core(&ctx.store, &ctx.auth, req).await?;
    let project_id = project_of_module(ctx, &module_id).await?;
    Ok(module_row(&m, &project_id))
}

pub const DELETE_MODULE: ToolMeta = ToolMeta {
    name: "delete_module",
    description: "Delete an EMPTY module. Refused while the module still has \
                  tasks — move them elsewhere with move_task first. Only the \
                  project owner or an admin may do this.",
    schema: || {
        json!({
            "type": "object",
            "properties": { "module_id": { "type": "string" } },
            "required": ["module_id"]
        })
    },
    handler: |ctx, args| Box::pin(delete_module(ctx, args)),
};

pub async fn delete_module(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let module_id = str_arg(args, "module_id")?;
    // The Connect handler cascades — deleting a module deletes its tasks. The
    // MCP surface leaves out `delete_task` so an agent can't silently drop
    // work; a cascading `delete_module` would be a bigger version of that
    // hole. Refuse up front, naming the way out.
    let tasks = module_task_count(&ctx.store, &ctx.auth, &module_id).await?;
    if tasks > 0 {
        return Err(ToolError::Business(format!(
            "module still has {tasks} task(s); move them to another module with move_task before deleting it"
        )));
    }
    let req = work_pb::DeleteModuleRequest { id: module_id };
    let resp = delete_module_core(&ctx.store, &ctx.auth, req).await?;
    Ok(json!({ "ok": resp.ok }))
}
