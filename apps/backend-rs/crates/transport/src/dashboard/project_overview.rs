//! DashboardService::GetProjectOverview — single-project read aggregation for
//! the Overview tab. Member-gated like ProjectService::GetProject.
//!
//! The counting rules are deliberately identical to `GetDashboardStats`
//! (cancelled excluded everywhere; overdue = past due and not done) so the
//! dashboard and the project tab can never show different numbers.

use std::collections::{HashMap, HashSet};

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::task::TaskStatus;

use super::context::today;
use super::{internal, require_auth, StoreExt};
use crate::media::record::ready_media_for_project;
use crate::pages::record::pages_for_project;
use crate::projects::parse_pid;
use crate::projects::record::{is_member, load_project, project_member_ids};
use crate::sedjiwa::tasks::dashboard::v1 as pb;
use crate::work::record::modules_for_project;
use crate::work::task_record::tasks_for_modules;

pub(super) async fn get_project_overview(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetProjectOverviewRequest>,
) -> Result<ConnectResponse<pb::ProjectOverview>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(r.project_id.trim())?;
    let project = load_project(&store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("project not found"))?;
    let project_id = pid.to_string();
    if !auth.is_admin()
        && !is_member(&store, &project_id, &auth.id)
            .await
            .map_err(internal)?
    {
        return Err(ConnectError::new_permission_denied("not a member"));
    }

    // Modules come back sorted by (order, pid); one task query covers them all.
    let modules = modules_for_project(&store, &project_id)
        .await
        .map_err(internal)?;
    let module_ids: HashSet<String> = modules.iter().map(|m| m.pid.to_string()).collect();
    let tasks = tasks_for_modules(&store, module_ids)
        .await
        .map_err(internal)?;
    let today = today();

    let mut total = 0u32;
    let mut in_progress = 0u32;
    let mut done = 0u32;
    let mut overdue = 0u32;
    // module_id → (done, total)
    let mut per: HashMap<String, (u32, u32)> = HashMap::new();

    for t in &tasks {
        if t.status == TaskStatus::Cancelled {
            continue; // cancelled counts nowhere
        }
        total += 1;
        match t.status {
            TaskStatus::InProgress => in_progress += 1,
            TaskStatus::Done => done += 1,
            _ => {}
        }
        if let Some(due) = &t.due_date {
            if due.as_str() < today.as_str() && t.status != TaskStatus::Done {
                overdue += 1;
            }
        }
        let e = per.entry(t.module_id.clone()).or_insert((0, 0));
        e.1 += 1;
        if t.status == TaskStatus::Done {
            e.0 += 1;
        }
    }

    // Driven off `modules`, not off `per`: a module with no tasks must still
    // appear (as 0/0), and the module order is the one the Tasks tab shows.
    let per_module: Vec<pb::ModuleProgress> = modules
        .iter()
        .map(|m| {
            let (d, tot) = per.get(&m.pid.to_string()).copied().unwrap_or((0, 0));
            pb::ModuleProgress {
                module_id: m.pid.to_string(),
                module_name: m.name.clone(),
                done: d,
                total: tot,
            }
        })
        .collect();

    // Owner first; the helper already returns the rest sorted and deduped.
    let mut member_ids = project_member_ids(&store, &project_id)
        .await
        .map_err(internal)?;
    if let Some(i) = member_ids.iter().position(|u| u == &project.owner_id) {
        let owner = member_ids.remove(i);
        member_ids.insert(0, owner);
    }

    let page_count = pages_for_project(&store, &project_id)
        .await
        .map_err(internal)?
        .len() as u32;
    let media_count = ready_media_for_project(&store, &project_id)
        .await
        .map_err(internal)?
        .len() as u32;

    Ok(ConnectResponse::new(pb::ProjectOverview {
        total_tasks: total,
        in_progress_tasks: in_progress,
        done_tasks: done,
        overdue_tasks: overdue,
        per_module,
        member_ids,
        module_count: modules.len() as u32,
        page_count,
        media_count,
    }))
}
