//! Task templates: list them, and create a task (with its subtasks) from one.

use serde_json::{json, Value};
use transport::api::{create_task_from_template_core, list_task_templates_core, template_pb};

use super::tasks::flatten;
use super::{opt_str, opt_str_list, str_arg, truncate, Ctx, ToolError, ToolMeta};

pub const LIST_TASK_TEMPLATES: ToolMeta = ToolMeta {
    name: "list_task_templates",
    description: "A project's task templates: reusable tasks with a title, description, \
                  priority, estimate, labels and subtasks.",
    schema: || {
        json!({
            "type": "object",
            "properties": { "project_id": { "type": "string" } },
            "required": ["project_id"]
        })
    },
    handler: |ctx, args| Box::pin(list_task_templates(ctx, args)),
};

pub async fn list_task_templates(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = template_pb::ListTaskTemplatesRequest { project_id: str_arg(args, "project_id")? };
    let resp = list_task_templates_core(&ctx.store, &ctx.auth, req).await?;
    let rows: Vec<Value> = resp
        .templates
        .iter()
        .map(|t| json!({
            "id": t.id,
            "name": t.name,
            "title": t.title,
            "description": truncate(&t.description),
            "priority": domain::task::TaskPriority::from_proto(t.priority)
                .unwrap_or(domain::task::TaskPriority::None)
                .as_str(),
            "estimate_minutes": t.estimate_minutes,
            "label_ids": t.label_ids,
            "subtasks": t.subtasks.iter().map(|s| s.title.clone()).collect::<Vec<_>>(),
        }))
        .collect();
    Ok(json!({ "templates": rows }))
}

pub const CREATE_TASK_FROM_TEMPLATE: ToolMeta = ToolMeta {
    name: "create_task_from_template",
    description: "Create a task, with the template's subtasks, from a task template \
                  (see list_task_templates) in a module of the template's project.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "template_id": { "type": "string" },
                "module_id": { "type": "string", "description": "A module of the template's project." },
                "title": { "type": "string", "description": "Defaults to the template's title." },
                "assignee_ids": { "type": "array", "items": { "type": "string" } },
                "due_date": { "type": "string", "description": "yyyy-MM-dd" }
            },
            "required": ["template_id", "module_id"]
        })
    },
    handler: |ctx, args| Box::pin(create_task_from_template(ctx, args)),
};

pub async fn create_task_from_template(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = template_pb::CreateTaskFromTemplateRequest {
        template_id: str_arg(args, "template_id")?,
        module_id: str_arg(args, "module_id")?,
        title: opt_str(args, "title"),
        assignee_ids: opt_str_list(args, "assignee_ids")?.unwrap_or_default(),
        due_date: opt_str(args, "due_date"),
    };
    let t = create_task_from_template_core(&ctx.store, Some(&ctx.notifier), &ctx.auth, req).await?;
    Ok(flatten(&t))
}
