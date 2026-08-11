//! DashboardService: cross-project stats + upcoming deadlines.

use std::collections::HashMap;
use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::task::TaskStatus;
use persistence::Store;

use super::context::{date_plus, today, Context};
use super::project_overview::get_project_overview;
use super::{internal, require_auth, StoreExt};
use crate::sedjiwa::tasks::dashboard::v1 as pb;
use crate::sedjiwa::tasks::dashboard::v1::dashboard_service_connect::DashboardServiceBuilder;

const DEFAULT_WITHIN_DAYS: u32 = 7;

async fn get_dashboard_stats(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    _req: ConnectRequest<pb::GetDashboardStatsRequest>,
) -> Result<ConnectResponse<pb::DashboardStats>, ConnectError> {
    let auth = require_auth(user)?;
    let ctx = Context::load(&store, &auth).await.map_err(internal)?;
    let today = today();

    let mut total = 0u32;
    let mut in_progress = 0u32;
    let mut done = 0u32;
    let mut overdue = 0u32;
    // per-project (done, total), seeded with every scoped project (so empty ones show 0/0).
    let mut per: HashMap<String, (u32, u32)> = ctx
        .scoped_projects()
        .into_iter()
        .map(|p| (p, (0, 0)))
        .collect();

    for t in ctx.scoped_tasks() {
        if t.status == TaskStatus::Cancelled {
            continue; // total counts non-cancelled tasks
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
        if let Some(pj) = ctx.module_to_project.get(&t.module_id) {
            let e = per.entry(pj.clone()).or_insert((0, 0));
            e.1 += 1;
            if t.status == TaskStatus::Done {
                e.0 += 1;
            }
        }
    }

    let mut per_project: Vec<pb::ProjectProgress> = per
        .into_iter()
        .map(|(project_id, (d, tot))| pb::ProjectProgress {
            project_name: ctx.project_name(&project_id),
            project_id,
            done: d,
            total: tot,
        })
        .collect();
    per_project.sort_by(|a, b| a.project_name.cmp(&b.project_name).then(a.project_id.cmp(&b.project_id)));

    Ok(ConnectResponse::new(pb::DashboardStats {
        total_tasks: total,
        in_progress_tasks: in_progress,
        done_tasks: done,
        overdue_tasks: overdue,
        per_project,
    }))
}

async fn get_upcoming_deadlines(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetUpcomingDeadlinesRequest>,
) -> Result<ConnectResponse<pb::TaskListResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let within = if r.within_days == 0 {
        DEFAULT_WITHIN_DAYS
    } else {
        r.within_days
    };
    let ctx = Context::load(&store, &auth).await.map_err(internal)?;
    let (today, cutoff) = (today(), date_plus(within));

    // Tasks assigned to me, due within [today, cutoff], not done/cancelled.
    let mut due_tasks: Vec<_> = ctx
        .scoped_tasks()
        .into_iter()
        .filter(|t| t.assignee_ids.iter().any(|a| a == &auth.id))
        .filter(|t| !matches!(t.status, TaskStatus::Done | TaskStatus::Cancelled))
        .filter_map(|t| {
            t.due_date
                .as_ref()
                .filter(|d| d.as_str() >= today.as_str() && d.as_str() <= cutoff.as_str())
                .map(|d| (d.clone(), t))
        })
        .collect();
    due_tasks.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.pid.cmp(&b.1.pid)));

    Ok(ConnectResponse::new(pb::TaskListResponse {
        items: due_tasks.iter().map(|(_, t)| ctx.to_mytask(t)).collect(),
    }))
}

/// DashboardService router; injects the Store as a request extension.
pub fn dashboard_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    DashboardServiceBuilder::<()>::new()
        .get_dashboard_stats::<_, (StoreExt, A, ConnectRequest<pb::GetDashboardStatsRequest>)>(
            get_dashboard_stats,
        )
        .get_upcoming_deadlines::<_, (StoreExt, A, ConnectRequest<pb::GetUpcomingDeadlinesRequest>)>(
            get_upcoming_deadlines,
        )
        .get_project_overview::<_, (StoreExt, A, ConnectRequest<pb::GetProjectOverviewRequest>)>(
            get_project_overview,
        )
        .build()
        .layer(Extension(store))
}
