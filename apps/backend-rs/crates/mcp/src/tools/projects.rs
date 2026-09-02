//! Navigation tools: project and module. These are what the model uses to
//! find an id before touching a task — without them, `create_task` has no
//! `module_id` to work with, and the model's only option is guessing.

use serde_json::{json, Value};
use transport::api::{get_project_core, list_modules_core, list_projects_core, project_pb, work_pb};

use super::{limit_arg, str_arg, truncate, Ctx, ToolError, ToolMeta};

/// Proto `ProjectStatus` code → model-readable label, the project analogue of
/// `tasks::status_label`. A raw wire integer in tool output would break the
/// "enums as strings" rule every other tool follows.
fn status_label(v: i32) -> &'static str {
    domain::project::ProjectStatus::from_proto(v)
        .map(domain::project::ProjectStatus::as_str)
        // `from_proto` returns `None` for UNSPECIFIED(0) — a project row
        // always carries a real status once created, but a label is still
        // owed to the model rather than a panic or a bare `null`.
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
    Ok(json!({ "projects": rows, "count": count }))
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
                  after list_projects to find one.",
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
