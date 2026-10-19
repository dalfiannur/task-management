//! Automations: read rules and their runs, and write them (project owner or
//! admin, enforced by the core fns). Rules travel as the domain's own JSON
//! (`kind`-tagged trigger and actions), except that a status may be given by
//! name wherever the rule stores a status id; replies carry both.

use domain::automation::{Action, Conditions, Mode, Trigger};
use serde_json::{json, Value};
use transport::api::{
    automation_parts, automation_parts_to_proto, automation_pb, create_automation_core,
    delete_automation_core, get_automation_core, list_automation_runs_core,
    list_automations_core, list_task_statuses_core, set_automation_mode_core,
    update_automation_core, work_pb,
};

use super::{limit_arg, opt_str, str_arg, Ctx, ToolError, ToolMeta};

const TRIGGER_HELP: &str = "`trigger` is an object with `kind`: \
    {\"kind\":\"status_changed\",\"from\":<status, optional>,\"to\":<status, optional>}, \
    {\"kind\":\"task_created\"}, {\"kind\":\"assignee_added\"}, {\"kind\":\"subtasks_done\"}, \
    {\"kind\":\"overdue\"}, {\"kind\":\"due_in\",\"days\":1..30}";

const ACTION_HELP: &str = "each action is an object with `kind`: \
    {\"kind\":\"set_status\",\"status\":<name>}, {\"kind\":\"set_priority\",\"priority\":\"none|low|medium|high|urgent\"}, \
    {\"kind\":\"add_label\",\"label_id\":..}, {\"kind\":\"remove_label\",\"label_id\":..}, \
    {\"kind\":\"assign\",\"user_id\":<id, or \"\" for the task's creator>}, {\"kind\":\"unassign_all\"}, \
    {\"kind\":\"move_to_module\",\"module_id\":..}, {\"kind\":\"set_due_in\",\"days\":0..365}, \
    {\"kind\":\"notify\",\"target\":\"assignees|owner|user\",\"user_id\":<for user>,\"message\":..}, \
    {\"kind\":\"comment\",\"text\":..}";

fn rule_schema() -> Value {
    json!({
        "trigger": { "type": "object", "description": TRIGGER_HELP },
        "conditions": {
            "type": "object",
            "description": "Optional. Every non-empty list must match; within a list any value does.",
            "properties": {
                "priorities": { "type": "array", "items": { "type": "string", "enum": ["none", "low", "medium", "high", "urgent"] } },
                "label_ids": { "type": "array", "items": { "type": "string" } },
                "module_ids": { "type": "array", "items": { "type": "string" } }
            }
        },
        "actions": { "type": "array", "items": { "type": "object" }, "minItems": 1, "description": ACTION_HELP }
    })
}

/// The project's statuses, for translating names ↔ ids.
async fn statuses(ctx: &Ctx, project_id: &str) -> Result<Vec<work_pb::TaskStatusDef>, ToolError> {
    Ok(list_task_statuses_core(
        &ctx.store,
        &ctx.auth,
        work_pb::ListTaskStatusesRequest { project_id: project_id.to_string() },
    )
    .await?
    .statuses)
}

/// A status id or name → its id. A category name picks the category's first
/// status only where `category_ok` (an action); a trigger keeps its meaning
/// exact.
fn status_id(all: &[work_pb::TaskStatusDef], value: &str, category_ok: bool) -> Result<String, ToolError> {
    let v = value.trim();
    if let Some(s) = all.iter().find(|s| s.id == v || s.name.eq_ignore_ascii_case(v)) {
        return Ok(s.id.clone());
    }
    if category_ok {
        if let Some(c) = domain::task::TaskStatus::parse(v) {
            if let Some(s) = all.iter().find(|s| s.category == c.to_proto()) {
                return Ok(s.id.clone());
            }
        }
    }
    let names: Vec<&str> = all.iter().map(|s| s.name.as_str()).collect();
    Err(ToolError::BadArgs(format!(
        "no status `{v}` in this project; its statuses are: {}",
        names.join(", ")
    )))
}

fn status_name(all: &[work_pb::TaskStatusDef], id: &str) -> Value {
    all.iter().find(|s| s.id == id).map_or(Value::Null, |s| json!(s.name))
}

fn parse_trigger(all: &[work_pb::TaskStatusDef], v: &Value) -> Result<Trigger, ToolError> {
    let mut v = v.clone();
    if v.get("kind").and_then(Value::as_str) == Some("status_changed") {
        for key in ["from", "to"] {
            if let Some(s) = v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()) {
                let id = status_id(all, s, false)?;
                v[key] = json!(id);
            }
        }
    }
    serde_json::from_value(v).map_err(|e| ToolError::BadArgs(format!("bad trigger ({e}); {TRIGGER_HELP}")))
}

fn parse_actions(all: &[work_pb::TaskStatusDef], v: &Value) -> Result<Vec<Action>, ToolError> {
    let items = v
        .as_array()
        .ok_or_else(|| ToolError::BadArgs(format!("`actions` must be an array; {ACTION_HELP}")))?;
    items
        .iter()
        .map(|a| {
            let mut a = a.clone();
            if a.get("kind").and_then(Value::as_str) == Some("set_status") && a.get("status_id").is_none() {
                if let Some(s) = a.get("status").and_then(Value::as_str) {
                    let id = status_id(all, s, true)?;
                    a["status_id"] = json!(id);
                }
            }
            serde_json::from_value::<Action>(a)
                .map_err(|e| ToolError::BadArgs(format!("bad action ({e}); {ACTION_HELP}")))
        })
        .collect()
}

fn parse_conditions(v: Option<&Value>) -> Result<Conditions, ToolError> {
    match v {
        None | Some(Value::Null) => Ok(Conditions::default()),
        Some(v) => serde_json::from_value(v.clone())
            .map_err(|e| ToolError::BadArgs(format!("bad conditions ({e})"))),
    }
}

fn mode_arg(args: &Value) -> Result<Option<Mode>, ToolError> {
    match opt_str(args, "mode") {
        None => Ok(None),
        Some(s) => Mode::parse(&s)
            .map(Some)
            .ok_or_else(|| ToolError::BadArgs(format!("`mode` must be off, observe or on (got `{s}`)"))),
    }
}

fn mode_label(m: i32) -> &'static str {
    Mode::from_proto(m).map_or("unknown", Mode::as_str)
}

/// A rule as the model sees it: domain JSON plus status names.
fn flatten(a: &automation_pb::Automation, all: &[work_pb::TaskStatusDef]) -> Result<Value, ToolError> {
    let (trigger, conditions, actions) = automation_parts(a)?;
    let mut t = serde_json::to_value(&trigger).unwrap_or(Value::Null);
    if let Trigger::StatusChanged { from, to } = &trigger {
        t["from_name"] = from.as_deref().map_or(Value::Null, |id| status_name(all, id));
        t["to_name"] = to.as_deref().map_or(Value::Null, |id| status_name(all, id));
    }
    let acts: Vec<Value> = actions
        .iter()
        .map(|x| {
            let mut v = serde_json::to_value(x).unwrap_or(Value::Null);
            if let Action::SetStatus { status_id } = x {
                v["status_name"] = status_name(all, status_id);
            }
            v
        })
        .collect();
    Ok(json!({
        "id": a.id,
        "project_id": a.project_id,
        "name": a.name,
        "mode": mode_label(a.mode),
        "trigger": t,
        "conditions": conditions,
        "actions": acts,
        "run_count": a.run_count,
        "last_run_at": a.last_run_at,
        "observed_count": a.observed_count,
        "last_observed_at": a.last_observed_at,
        "updated_by": a.updated_by,
        "updated_at": a.updated_at,
    }))
}

pub const LIST_AUTOMATIONS: ToolMeta = ToolMeta {
    name: "list_automations",
    description: "A project's automation rules (when → if → then), each with its mode: off, \
                  observe (records what it would do, changes nothing) or on.",
    schema: || {
        json!({
            "type": "object",
            "properties": { "project_id": { "type": "string" } },
            "required": ["project_id"]
        })
    },
    handler: |ctx, args| Box::pin(list_automations(ctx, args)),
};

pub async fn list_automations(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let project_id = str_arg(args, "project_id")?;
    let resp = list_automations_core(
        &ctx.store,
        &ctx.auth,
        automation_pb::ListAutomationsRequest { project_id: project_id.clone() },
    )
    .await?;
    let all = statuses(ctx, &project_id).await?;
    let rows = resp.automations.iter().map(|a| flatten(a, &all)).collect::<Result<Vec<_>, _>>()?;
    Ok(json!({ "automations": rows }))
}

pub const LIST_AUTOMATION_RUNS: ToolMeta = ToolMeta {
    name: "list_automation_runs",
    description: "What a project's automations did (or, in observe mode, would have done), \
                  newest first: the task, the trigger, ok / failed / skipped / observed, and \
                  the detail.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "automation_id": { "type": "string", "description": "Only this rule." },
                "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
            },
            "required": ["project_id"]
        })
    },
    handler: |ctx, args| Box::pin(list_automation_runs(ctx, args)),
};

pub async fn list_automation_runs(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let resp = list_automation_runs_core(
        &ctx.store,
        &ctx.auth,
        automation_pb::ListAutomationRunsRequest {
            project_id: str_arg(args, "project_id")?,
            automation_id: opt_str(args, "automation_id"),
            limit: limit_arg(args)? as i32,
        },
    )
    .await?;
    let rows: Vec<Value> = resp
        .runs
        .iter()
        .map(|r| json!({
            "id": r.id,
            "automation_id": r.automation_id,
            "automation_name": r.automation_name,
            "task_id": r.task_id,
            "task_number": r.task_number,
            "task_title": r.task_title,
            "trigger": r.trigger,
            "status": match automation_pb::RunStatus::try_from(r.status) {
                Ok(automation_pb::RunStatus::Ok) => "ok",
                Ok(automation_pb::RunStatus::Failed) => "failed",
                Ok(automation_pb::RunStatus::Skipped) => "skipped",
                Ok(automation_pb::RunStatus::Observed) => "observed",
                _ => "unknown",
            },
            "detail": r.detail,
            "created_at": r.created_at,
        }))
        .collect();
    Ok(json!({ "runs": rows }))
}

pub const CREATE_AUTOMATION: ToolMeta = ToolMeta {
    name: "create_automation",
    description: "Create an automation rule in a project (project owner or admin only). It \
                  starts in observe mode unless `mode` says otherwise: it then only records \
                  what it would do, so check list_automation_runs before switching it on \
                  with set_automation_mode.",
    schema: || {
        let mut props = rule_schema();
        props["project_id"] = json!({ "type": "string" });
        props["name"] = json!({ "type": "string" });
        props["mode"] = json!({ "type": "string", "enum": ["off", "observe", "on"], "description": "Default observe." });
        json!({ "type": "object", "properties": props, "required": ["project_id", "name", "trigger", "actions"] })
    },
    handler: |ctx, args| Box::pin(create_automation(ctx, args)),
};

pub async fn create_automation(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let project_id = str_arg(args, "project_id")?;
    let all = statuses(ctx, &project_id).await?;
    let trigger = parse_trigger(&all, args.get("trigger").unwrap_or(&Value::Null))?;
    let actions = parse_actions(&all, args.get("actions").unwrap_or(&Value::Null))?;
    let conditions = parse_conditions(args.get("conditions"))?;
    let (t, c, a) = automation_parts_to_proto(&trigger, &conditions, &actions);
    let saved = create_automation_core(
        &ctx.store,
        &ctx.auth,
        automation_pb::SaveAutomationRequest {
            id: String::new(),
            project_id,
            name: str_arg(args, "name")?,
            trigger: Some(t),
            conditions: Some(c),
            actions: a,
            mode: mode_arg(args)?.unwrap_or(Mode::Observe).to_proto(),
        },
    )
    .await?;
    flatten(&saved, &all)
}

pub const UPDATE_AUTOMATION: ToolMeta = ToolMeta {
    name: "update_automation",
    description: "Change an automation rule (project owner or admin only). Send only what \
                  changes: `name`, `trigger`, `conditions` or `actions` (a list you send \
                  replaces the whole list). Its mode is changed with set_automation_mode.",
    schema: || {
        let mut props = rule_schema();
        props["id"] = json!({ "type": "string" });
        props["name"] = json!({ "type": "string" });
        json!({ "type": "object", "properties": props, "required": ["id"] })
    },
    handler: |ctx, args| Box::pin(update_automation(ctx, args)),
};

pub async fn update_automation(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let id = str_arg(args, "id")?;
    let current = get_automation_core(&ctx.store, &ctx.auth, &id).await?;
    let all = statuses(ctx, &current.project_id).await?;
    let (mut trigger, mut conditions, mut actions) = automation_parts(&current)?;
    let mut changed = false;
    if let Some(v) = args.get("trigger").filter(|v| !v.is_null()) {
        trigger = parse_trigger(&all, v)?;
        changed = true;
    }
    if let Some(v) = args.get("conditions").filter(|v| !v.is_null()) {
        conditions = parse_conditions(Some(v))?;
        changed = true;
    }
    if let Some(v) = args.get("actions").filter(|v| !v.is_null()) {
        actions = parse_actions(&all, v)?;
        changed = true;
    }
    let name = opt_str(args, "name");
    if name.is_none() && !changed {
        return Err(ToolError::BadArgs(
            "nothing to change: send `name`, `trigger`, `conditions` or `actions`".into(),
        ));
    }
    let (t, c, a) = automation_parts_to_proto(&trigger, &conditions, &actions);
    let saved = update_automation_core(
        &ctx.store,
        &ctx.auth,
        automation_pb::SaveAutomationRequest {
            id,
            project_id: current.project_id.clone(),
            name: name.unwrap_or(current.name.clone()),
            trigger: Some(t),
            conditions: Some(c),
            actions: a,
            mode: 0,
        },
    )
    .await?;
    flatten(&saved, &all)
}

pub const DELETE_AUTOMATION: ToolMeta = ToolMeta {
    name: "delete_automation",
    description: "Delete an automation rule and its run history for good (project owner or \
                  admin only). To pause a rule and keep its history, set its mode to off \
                  instead.",
    schema: || {
        json!({
            "type": "object",
            "properties": { "id": { "type": "string" } },
            "required": ["id"]
        })
    },
    handler: |ctx, args| Box::pin(delete_automation(ctx, args)),
};

pub async fn delete_automation(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let id = str_arg(args, "id")?;
    delete_automation_core(&ctx.store, &ctx.auth, automation_pb::DeleteAutomationRequest { id: id.clone() })
        .await?;
    Ok(json!({ "deleted": true, "id": id }))
}

pub const SET_AUTOMATION_MODE: ToolMeta = ToolMeta {
    name: "set_automation_mode",
    description: "Switch an automation rule off, to observe (records what it would do, \
                  changes nothing) or on (project owner or admin only).",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "id": { "type": "string" },
                "mode": { "type": "string", "enum": ["off", "observe", "on"] }
            },
            "required": ["id", "mode"]
        })
    },
    handler: |ctx, args| Box::pin(set_automation_mode(ctx, args)),
};

pub async fn set_automation_mode(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let mode = mode_arg(args)?.ok_or_else(|| ToolError::BadArgs("`mode` is required: off, observe or on".into()))?;
    let saved = set_automation_mode_core(
        &ctx.store,
        &ctx.auth,
        automation_pb::SetAutomationModeRequest { id: str_arg(args, "id")?, mode: mode.to_proto() },
    )
    .await?;
    let all = statuses(ctx, &saved.project_id).await?;
    flatten(&saved, &all)
}
