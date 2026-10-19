//! Planning reads: a project's statuses, the workload, the timesheet and the
//! saved views. Each calls the same core fn as the UI (member-gated there).

use serde_json::{json, Value};
use transport::api::{
    list_saved_views_core, list_task_statuses_core, list_time_entries_core, time_pb, view_pb,
    work_pb, workload_core, workload_pb,
};

use super::tasks::status_label;
use super::{limit_arg, opt_str, str_arg, Ctx, ToolError, ToolMeta};

pub const LIST_STATUSES: ToolMeta = ToolMeta {
    name: "list_statuses",
    description: "List a project's task statuses in board order, each with its category \
                  (todo, in_progress, done, cancelled). Task tools accept a status by \
                  these names.",
    schema: || {
        json!({
            "type": "object",
            "properties": { "project_id": { "type": "string" } },
            "required": ["project_id"]
        })
    },
    handler: |ctx, args| Box::pin(list_statuses(ctx, args)),
};

pub async fn list_statuses(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = work_pb::ListTaskStatusesRequest { project_id: str_arg(args, "project_id")? };
    let resp = list_task_statuses_core(&ctx.store, &ctx.auth, req).await?;
    let rows: Vec<Value> = resp
        .statuses
        .iter()
        .map(|s| json!({
            "id": s.id,
            "name": s.name,
            "category": status_label(s.category),
            "color": s.color,
        }))
        .collect();
    Ok(json!({ "statuses": rows }))
}

pub const GET_WORKLOAD: ToolMeta = ToolMeta {
    name: "get_workload",
    description: "Planned effort against capacity per person, week by week, over the \
                  projects you can see (or one project). Minutes come from task estimates \
                  spread over each task's dates. `other_*` is the same person's load in \
                  projects outside this view, as totals only. Pass `user_id` to also get \
                  that person's tasks.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Only this project. Omit for every project you are a member of." },
                "weeks": { "type": "integer", "minimum": 1, "maximum": 12, "description": "Weeks from this week on; default 6." },
                "user_id": { "type": "string", "description": "Only this person, with their task list." }
            }
        })
    },
    handler: |ctx, args| Box::pin(get_workload(ctx, args)),
};

pub async fn get_workload(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let weeks = match args.get("weeks") {
        None | Some(Value::Null) => 0,
        Some(v) => v
            .as_i64()
            .filter(|n| (1..=12).contains(n))
            .ok_or_else(|| ToolError::BadArgs("`weeks` must be a whole number between 1 and 12".into()))?
            as i32,
    };
    let user = opt_str(args, "user_id");
    let w = workload_core(
        &ctx.store,
        &ctx.auth,
        workload_pb::GetWorkloadRequest { project_id: opt_str(args, "project_id"), today: None, weeks },
    )
    .await?;
    let members: Vec<Value> = w
        .members
        .iter()
        .filter(|m| user.as_deref().is_none_or(|u| m.user_id == u))
        .map(|m| {
            let mut v = json!({
                "user_id": m.user_id,
                "name": m.user_name,
                "weekly_capacity_minutes": m.weekly_minutes,
                "working_days": m.working_days,
                "weeks": m.weeks.iter().zip(&w.week_starts).map(|(k, start)| json!({
                    "week_start": start,
                    "capacity_minutes": k.capacity_minutes,
                    "planned_minutes": k.planned_minutes,
                    "other_minutes": k.other_minutes,
                })).collect::<Vec<_>>(),
                "overdue_minutes": m.overdue_minutes,
                "unscheduled_minutes": m.unscheduled_minutes,
                "later_minutes": m.later_minutes,
                "total_minutes": m.total_minutes,
                "other_overdue_minutes": m.other_overdue_minutes,
                "other_unscheduled_minutes": m.other_unscheduled_minutes,
                "other_later_minutes": m.other_later_minutes,
                "calendar_conflict": m.calendar_conflict,
            });
            if user.is_some() {
                v["tasks"] = m
                    .tasks
                    .iter()
                    .map(|t| json!({
                        "task_id": t.task_id,
                        "project_id": t.project_id,
                        "project_name": t.project_name,
                        "number": t.number,
                        "title": t.title,
                        "remaining_minutes": t.remaining_minutes,
                        "start_date": t.start_date,
                        "due_date": t.due_date,
                        "bucket": match workload_pb::WorkloadBucket::try_from(t.bucket) {
                            Ok(workload_pb::WorkloadBucket::Scheduled) => "scheduled",
                            Ok(workload_pb::WorkloadBucket::Overdue) => "overdue",
                            Ok(workload_pb::WorkloadBucket::Unscheduled) => "unscheduled",
                            _ => "unknown",
                        },
                        "calendar_conflict": t.calendar_conflict,
                    }))
                    .collect();
            }
            v
        })
        .collect();
    if let Some(u) = &user {
        if members.is_empty() {
            return Err(ToolError::Business(format!(
                "no workload for user `{u}` in this scope: they are not a member and have no tasks assigned here"
            )));
        }
    }
    Ok(json!({
        "week_starts": w.week_starts,
        "projects": w.projects.iter().map(|p| json!({ "id": p.id, "name": p.name })).collect::<Vec<_>>(),
        "members": members,
    }))
}

pub const LIST_TIME_ENTRIES: ToolMeta = ToolMeta {
    name: "list_time_entries",
    description: "The timesheet: time entries, newest first, by task, project and/or person \
                  and date range. Give at least one of task_id, project_id or user_id. \
                  `total_minutes` sums the entries returned.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "task_id": { "type": "string" },
                "project_id": { "type": "string" },
                "user_id": { "type": "string" },
                "from": { "type": "string", "description": "First day, yyyy-MM-dd (inclusive)." },
                "to": { "type": "string", "description": "Last day, yyyy-MM-dd (inclusive)." },
                "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
            }
        })
    },
    handler: |ctx, args| Box::pin(list_time_entries(ctx, args)),
};

pub async fn list_time_entries(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = time_pb::ListTimeEntriesRequest {
        task_id: opt_str(args, "task_id"),
        project_id: opt_str(args, "project_id"),
        user_id: opt_str(args, "user_id"),
        from: opt_str(args, "from"),
        to: opt_str(args, "to"),
    };
    if req.task_id.is_none() && req.project_id.is_none() && req.user_id.is_none() {
        return Err(ToolError::BadArgs(
            "give at least one of `task_id`, `project_id` or `user_id`".into(),
        ));
    }
    let limit = limit_arg(args)?;
    let resp = list_time_entries_core(&ctx.store, &ctx.auth, req).await?;
    let more = resp.entries.len() > limit;
    let rows: Vec<Value> = resp
        .entries
        .iter()
        .take(limit)
        .map(|e| json!({
            "id": e.id,
            "task_id": e.task_id,
            "task_number": e.task_number,
            "task_title": e.task_title,
            "project_id": e.project_id,
            "user_id": e.user_id,
            "date": e.date,
            "minutes": e.minutes,
            "running": e.running,
            "note": e.note,
        }))
        .collect();
    let total: i64 = resp.entries.iter().take(limit).map(|e| i64::from(e.minutes)).sum();
    let count = rows.len();
    Ok(json!({ "entries": rows, "count": count, "total_minutes": total, "truncated": more }))
}

pub const LIST_SAVED_VIEWS: ToolMeta = ToolMeta {
    name: "list_saved_views",
    description: "A project's saved task views (yours and the shared ones), each with the \
                  filter query people use in the app.",
    schema: || {
        json!({
            "type": "object",
            "properties": { "project_id": { "type": "string" } },
            "required": ["project_id"]
        })
    },
    handler: |ctx, args| Box::pin(list_saved_views(ctx, args)),
};

pub async fn list_saved_views(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = view_pb::ListSavedViewsRequest { project_id: str_arg(args, "project_id")? };
    let resp = list_saved_views_core(&ctx.store, &ctx.auth, req).await?;
    let rows: Vec<Value> = resp
        .views
        .iter()
        .map(|v| json!({
            "id": v.id,
            "name": v.name,
            "query": v.query,
            "layout": if v.layout == view_pb::ViewLayout::Board as i32 { "board" } else { "list" },
            "shared": v.shared,
            "owner_id": v.owner_id,
        }))
        .collect();
    Ok(json!({ "views": rows }))
}
