//! DashboardService::GetProjectOverview — single-project read aggregation for
//! the Overview tab. Member-gated like ProjectService::GetProject.
//!
//! The headline counts go through `Tally`, the same rule set `GetDashboardStats`
//! uses, so the dashboard and the project tab can never show different numbers.

use std::collections::{HashMap, HashSet};

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::task::TaskStatus;

use super::context::{today, Tally};
use super::{internal, require_auth, StoreExt};
use crate::media::ready_media_count_for_project;
use crate::pages::page_count_for_project;
use crate::projects::parse_pid;
use crate::projects::record::{load_project, project_member_ids};
use crate::sedjiwa::tasks::dashboard::v1 as pb;
use crate::work::record::modules_for_project;
use crate::work::task_record::tasks_for_modules;

#[derive(Default, Clone, Copy)]
struct Progress {
    done: u32,
    total: u32,
}

pub(super) async fn get_project_overview(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetProjectOverviewRequest>,
) -> Result<ConnectResponse<pb::ProjectOverview>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.project_id)?;
    let project = load_project(&store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("project not found"))?;
    let project_id = pid.to_string();

    // One membership scan serves both the gate and the response, and a denied
    // caller returns before any module/task/page/media work.
    let mut member_ids = project_member_ids(&store, &project_id)
        .await
        .map_err(internal)?;
    if !auth.is_admin() && !member_ids.iter().any(|u| u == &auth.id) {
        return Err(ConnectError::new_permission_denied("not a member"));
    }

    // Modules come back sorted by (order, pid); one task query covers them all.
    let modules = modules_for_project(&store, &project_id)
        .await
        .map_err(internal)?;
    let module_ids: HashSet<String> = modules.iter().map(|m| m.pid.to_string()).collect();
    // An empty set would still scan every task in the DB just to filter it out.
    let tasks = if module_ids.is_empty() {
        Vec::new()
    } else {
        tasks_for_modules(&store, module_ids).await.map_err(internal)?
    };
    let today = today();

    let mut tally = Tally::default();
    let mut per_module_counts: HashMap<String, Progress> = HashMap::new();
    for t in &tasks {
        if !tally.add(t, &today) {
            continue; // cancelled counts nowhere
        }
        let counts = per_module_counts.entry(t.module_id.clone()).or_default();
        counts.total += 1;
        if t.status == TaskStatus::Done {
            counts.done += 1;
        }
    }

    // Driven off `modules`, not off the counts map: a module with no tasks must
    // still appear (as 0/0), and the module order is the one the Tasks tab shows.
    let per_module: Vec<pb::ModuleProgress> = modules
        .iter()
        .map(|m| {
            let module_id = m.pid.to_string();
            let p = per_module_counts.get(&module_id).copied().unwrap_or_default();
            pb::ModuleProgress {
                module_id,
                module_name: m.name.clone(),
                done: p.done,
                total: p.total,
            }
        })
        .collect();

    // "Owner first, then the rest" is unconditional: if the owner has no
    // membership row (torn create — see `create_project`), prepend them anyway
    // rather than silently dropping them from the list.
    match member_ids.iter().position(|u| u == &project.owner_id) {
        Some(i) => {
            let owner = member_ids.remove(i);
            member_ids.insert(0, owner);
        }
        None => member_ids.insert(0, project.owner_id.clone()),
    }

    let page_count = page_count_for_project(&store, &project_id)
        .await
        .map_err(internal)?;
    let media_count = ready_media_count_for_project(&store, &project_id)
        .await
        .map_err(internal)?;

    Ok(ConnectResponse::new(pb::ProjectOverview {
        total_tasks: tally.total,
        in_progress_tasks: tally.in_progress,
        done_tasks: tally.done,
        overdue_tasks: tally.overdue,
        per_module,
        member_ids,
        module_count: modules.len() as u32,
        page_count,
        media_count,
    }))
}
