//! WorkloadService: the per-week workload of people across their projects,
//! and the working-day calendars (global → project / user) it is spread over.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::workload::{
    allocation_days, days_ok, format_date, iso_from_mask, mask_from_iso, parse_date, place,
    remaining, share, week_capacity, weekly_minutes_ok, Horizon, Placement, DEFAULT_WEEKLY_MINUTES,
    DEFAULT_WEEKS,
};
use persistence::Store;
use time::OffsetDateTime;

use super::record::{self as wl, CalendarRow, OpenTask};
use crate::projects::record::{load_all_projects, load_project, member_project_ids};
use crate::sedjiwa::tasks::workload::v1 as pb;
use crate::sedjiwa::tasks::workload::v1::workload_service_connect::WorkloadServiceBuilder;
use crate::work::{internal, parse_pid, require_auth, require_member, require_owner_or_admin, StoreExt};

// ── Calendars ────────────────────────────────────────────────────────────────

fn scope_of(code: i32) -> Result<pb::CalendarScope, ConnectError> {
    match pb::CalendarScope::try_from(code) {
        Ok(s) if s != pb::CalendarScope::Unspecified => Ok(s),
        _ => Err(ConnectError::new_invalid_argument("scope is required")),
    }
}

/// The project, member-gated (`not_found` when missing).
async fn require_project(store: &Store, id: &str, auth: &AuthUser) -> Result<i64, ConnectError> {
    let pid = parse_pid(id)?;
    load_project(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("project not found"))?;
    require_member(store, id, auth).await?;
    Ok(pid)
}

async fn require_user(store: &Store, id: &str) -> Result<i64, ConnectError> {
    let pid = parse_pid(id)?;
    if wl::is_user(store, pid).await.map_err(internal)? {
        Ok(pid)
    } else {
        Err(ConnectError::new_not_found("user not found"))
    }
}

async fn read_calendar(
    store: &Store,
    auth: &AuthUser,
    scope: pb::CalendarScope,
    id: &str,
) -> Result<pb::WorkCalendar, ConnectError> {
    let global = wl::global_days(store).await.map_err(internal)?;
    let mut out = pb::WorkCalendar { scope: scope as i32, ..Default::default() };
    match scope {
        pb::CalendarScope::Global => {
            out.working_days = iso_from_mask(global);
            out.effective_days = out.working_days.clone();
            out.can_edit = auth.is_admin();
        }
        pb::CalendarScope::Project => {
            let pid = require_project(store, id, auth).await?;
            let row = wl::calendar(store, pid).await.map_err(internal)?;
            out.id = id.to_string();
            out.working_days = row.working_days.map(iso_from_mask).unwrap_or_default();
            out.effective_days = iso_from_mask(row.working_days.unwrap_or(global));
            out.can_edit = require_owner_or_admin(store, id, auth).await.is_ok();
        }
        pb::CalendarScope::User => {
            let pid = require_user(store, id).await?;
            let row = wl::calendar(store, pid).await.map_err(internal)?;
            out.id = id.to_string();
            out.working_days = row.working_days.map(iso_from_mask).unwrap_or_default();
            out.effective_days = iso_from_mask(row.working_days.unwrap_or(global));
            out.weekly_minutes = row.weekly_minutes;
            out.effective_weekly_minutes = row.weekly_minutes.unwrap_or(DEFAULT_WEEKLY_MINUTES);
            out.can_edit = auth.id == id || auth.is_admin();
        }
        pb::CalendarScope::Unspecified => unreachable!("scope_of rejects it"),
    }
    Ok(out)
}

async fn get_work_calendar(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetWorkCalendarRequest>,
) -> Result<ConnectResponse<pb::WorkCalendar>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let scope = scope_of(r.scope)?;
    Ok(ConnectResponse::new(read_calendar(&store, &auth, scope, &r.id).await?))
}

async fn set_work_calendar(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::SetWorkCalendarRequest>,
) -> Result<ConnectResponse<pb::WorkCalendar>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let scope = scope_of(r.scope)?;
    let days = match r.working_days.as_slice() {
        [] => None,
        d => Some(
            mask_from_iso(d)
                .filter(|m| days_ok(*m))
                .ok_or_else(|| ConnectError::new_invalid_argument("working days must be 1 (Mon) … 7 (Sun)"))?,
        ),
    };
    if r.weekly_minutes.is_some() && scope != pb::CalendarScope::User {
        return Err(ConnectError::new_invalid_argument("weekly hours are set per user"));
    }
    if r.weekly_minutes.is_some_and(|m| !weekly_minutes_ok(m)) {
        return Err(ConnectError::new_invalid_argument("weekly hours must be 0 … 168"));
    }
    match scope {
        pb::CalendarScope::Global => {
            if !auth.is_admin() {
                return Err(ConnectError::new_permission_denied("admin required"));
            }
            let mask = days.ok_or_else(|| {
                ConnectError::new_invalid_argument("the global calendar needs at least one working day")
            })?;
            wl::set_global_days(&store, mask).await.map_err(internal)?;
        }
        pb::CalendarScope::Project => {
            let pid = require_project(&store, &r.id, &auth).await?;
            require_owner_or_admin(&store, &r.id, &auth).await?;
            let row = CalendarRow { working_days: days, weekly_minutes: None };
            wl::set_calendar(&store, pid, row).await.map_err(internal)?;
        }
        pb::CalendarScope::User => {
            let pid = require_user(&store, &r.id).await?;
            if auth.id != r.id && !auth.is_admin() {
                return Err(ConnectError::new_permission_denied(
                    "only the user or an admin can change their calendar",
                ));
            }
            let row = CalendarRow { working_days: days, weekly_minutes: r.weekly_minutes };
            wl::set_calendar(&store, pid, row).await.map_err(internal)?;
        }
        pb::CalendarScope::Unspecified => unreachable!("scope_of rejects it"),
    }
    Ok(ConnectResponse::new(read_calendar(&store, &auth, scope, &r.id).await?))
}

// ── Workload ─────────────────────────────────────────────────────────────────

fn pids(ids: impl IntoIterator<Item = impl AsRef<str>>) -> Vec<i64> {
    ids.into_iter().filter_map(|s| s.as_ref().parse().ok()).collect()
}

/// One member's row while it is being summed.
struct Acc {
    days: i32,
    weekly: i32,
    row: pb::WorkloadMember,
}

/// Add one share of `t` to `acc`.
fn add_share(acc: &mut Acc, t: &OpenTask, minutes: i32, project_days: i32, h: &Horizon, project_name: &str) {
    let (mask, conflict) = allocation_days(acc.days, project_days);
    let start = t.start_date.as_deref().and_then(parse_date);
    let due = t.due_date.as_deref().and_then(parse_date);
    let row = &mut acc.row;
    let bucket = match place(minutes, start, due, mask, h) {
        Placement::Overdue => {
            row.overdue_minutes += minutes;
            pb::WorkloadBucket::Overdue
        }
        Placement::Unscheduled => {
            row.unscheduled_minutes += minutes;
            pb::WorkloadBucket::Unscheduled
        }
        Placement::Scheduled { weeks, later } => {
            for (w, m) in row.weeks.iter_mut().zip(weeks) {
                w.planned_minutes += m;
            }
            row.later_minutes += later;
            pb::WorkloadBucket::Scheduled
        }
    };
    row.total_minutes += minutes;
    row.calendar_conflict |= conflict;
    row.tasks.push(pb::WorkloadTask {
        task_id: t.pid.to_string(),
        project_id: t.project_id.clone(),
        project_name: project_name.to_string(),
        number: t.number,
        title: t.title.clone(),
        remaining_minutes: minutes,
        start_date: t.start_date.clone(),
        due_date: t.due_date.clone(),
        bucket: bucket as i32,
        calendar_conflict: conflict,
    });
}

/// The workload over `projects` for their members (and anyone assigned there).
pub async fn workload_core(
    store: &Store,
    auth: &AuthUser,
    r: pb::GetWorkloadRequest,
) -> Result<pb::Workload, ConnectError> {
    let today = match r.today.as_deref().filter(|s| !s.is_empty()) {
        Some(s) => parse_date(s)
            .filter(|_| s.len() == 10)
            .ok_or_else(|| ConnectError::new_invalid_argument("today must be yyyy-MM-dd"))?,
        None => OffsetDateTime::now_utc().date(),
    };
    let weeks = match r.weeks {
        0 => DEFAULT_WEEKS,
        w => usize::try_from(w).map_err(|_| ConnectError::new_invalid_argument("weeks must be positive"))?,
    };
    let h = Horizon::new(today, weeks);

    let projects: Vec<String> = match r.project_id.as_deref().filter(|s| !s.is_empty()) {
        Some(id) => {
            require_project(store, id, auth).await?;
            vec![id.to_string()]
        }
        None if auth.is_admin() => load_all_projects(store)
            .await
            .map_err(internal)?
            .iter()
            .map(|p| p.pid.to_string())
            .collect(),
        None => member_project_ids(store, &auth.id).await.map_err(internal)?,
    };

    let tasks = wl::open_tasks(store, &projects).await.map_err(internal)?;
    let mut user_ids = wl::members_of(store, &projects).await.map_err(internal)?;
    user_ids.extend(tasks.iter().flat_map(|t| t.assignees.iter().cloned()));
    user_ids.sort();
    user_ids.dedup();

    let user_pids = pids(&user_ids);
    let project_pids = pids(&projects);
    let global = wl::global_days(store).await.map_err(internal)?;
    let mut cal_pids = user_pids.clone();
    cal_pids.extend(&project_pids);
    let cals = wl::calendars(store, &cal_pids).await.map_err(internal)?;
    let people = wl::people(store, &user_pids).await.map_err(internal)?;
    let names = wl::project_names(store, &project_pids).await.map_err(internal)?;
    let days_of = |id: &str| {
        id.parse::<i64>()
            .ok()
            .and_then(|p| cals.get(&p))
            .and_then(|c| c.working_days)
            .unwrap_or(global)
    };
    let starts = h.week_starts();

    // Keyed by id; only real users get a row.
    let mut rows: HashMap<String, Acc> = HashMap::new();
    for id in &user_ids {
        let Some(p) = people.get(id) else { continue };
        let days = days_of(id);
        let weekly = id
            .parse::<i64>()
            .ok()
            .and_then(|p| cals.get(&p))
            .and_then(|c| c.weekly_minutes)
            .unwrap_or(DEFAULT_WEEKLY_MINUTES);
        let weeks = starts
            .iter()
            .map(|m| pb::WorkloadWeek {
                capacity_minutes: week_capacity(weekly, days, *m, h.today),
                planned_minutes: 0,
            })
            .collect();
        rows.insert(
            id.clone(),
            Acc {
                days,
                weekly,
                row: pb::WorkloadMember {
                    user_id: id.clone(),
                    user_name: p.name.clone(),
                    avatar_url: p.avatar_url.clone(),
                    weeks,
                    ..Default::default()
                },
            },
        );
    }

    for t in &tasks {
        let left = remaining(t.estimate, t.logged);
        if left == 0 {
            continue;
        }
        let project_days = days_of(&t.project_id);
        let project_name = names.get(&t.project_id).map_or("", String::as_str);
        let n = t.assignees.len();
        for (i, u) in t.assignees.iter().enumerate() {
            let minutes = share(left, n, i);
            if minutes == 0 {
                continue;
            }
            if let Some(acc) = rows.get_mut(u) {
                add_share(acc, t, minutes, project_days, &h, project_name);
            }
        }
    }

    // Name order, then id, for a stable list.
    let mut sorted: BTreeMap<(String, String), pb::WorkloadMember> = BTreeMap::new();
    for (id, acc) in rows {
        let mut row = acc.row;
        row.weekly_minutes = acc.weekly;
        row.working_days = iso_from_mask(acc.days);
        sorted.insert((row.user_name.to_lowercase(), id), row);
    }
    let mut projects: Vec<pb::WorkloadProject> = projects
        .into_iter()
        .map(|id| pb::WorkloadProject { name: names.get(&id).cloned().unwrap_or_default(), id })
        .collect();
    projects.sort_by_key(|p| p.name.to_lowercase());
    Ok(pb::Workload {
        week_starts: starts.into_iter().map(format_date).collect(),
        members: sorted.into_values().collect(),
        projects,
    })
}

async fn get_workload(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetWorkloadRequest>,
) -> Result<ConnectResponse<pb::Workload>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    Ok(ConnectResponse::new(workload_core(&store, &auth, r).await?))
}

/// WorkloadService router; injects the Store as a request extension.
pub fn workload_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    WorkloadServiceBuilder::<()>::new()
        .get_workload::<_, (StoreExt, A, ConnectRequest<pb::GetWorkloadRequest>)>(get_workload)
        .get_work_calendar::<_, (StoreExt, A, ConnectRequest<pb::GetWorkCalendarRequest>)>(get_work_calendar)
        .set_work_calendar::<_, (StoreExt, A, ConnectRequest<pb::SetWorkCalendarRequest>)>(set_work_calendar)
        .build()
        .layer(Extension(store))
}
