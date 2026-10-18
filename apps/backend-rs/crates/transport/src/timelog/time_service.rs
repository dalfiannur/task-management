//! TimeService: timer start/stop/read, hand-logged time, and the entry list
//! and edits. Logging needs membership of the task's project; every member
//! sees a project's entries; the author (or an admin) changes one.

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::time::{date_ok, entry_minutes_ok, note_ok};
use persistence::Store;

use super::record::{self as time_record, load_entry, now_iso, running_for, to_proto, today, EntryFilter, EntryRecord, NewEntry};
use crate::projects::record::member_project_ids;
use crate::sedjiwa::tasks::time::v1 as pb;
use crate::sedjiwa::tasks::time::v1::time_service_connect::TimeServiceBuilder;
use crate::work::{internal, parse_pid, require_auth, require_member, task_project_id, StoreExt};

/// The task's project, member-gated, or `not_found` for a missing task.
async fn task_scope(store: &Store, task_id: &str, auth: &AuthUser) -> Result<String, ConnectError> {
    let project = task_project_id(store, task_id)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("task not found"))?;
    require_member(store, &project, auth).await?;
    Ok(project)
}

fn work_date(date: Option<String>) -> Result<String, ConnectError> {
    match date.filter(|d| !d.is_empty()) {
        Some(d) if date_ok(&d) => Ok(d),
        Some(_) => Err(ConnectError::new_invalid_argument("date must be yyyy-MM-dd")),
        None => Ok(today()),
    }
}

fn clean_note(note: Option<String>) -> Result<String, ConnectError> {
    let n = note.unwrap_or_default().trim().to_string();
    if note_ok(&n) {
        Ok(n)
    } else {
        Err(ConnectError::new_invalid_argument("note is too long"))
    }
}

async fn require_entry(store: &Store, id: &str) -> Result<EntryRecord, ConnectError> {
    load_entry(store, parse_pid(id)?)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("time entry not found"))
}

/// The entry, if `auth` is its author or an admin (and still a member).
async fn own_entry(store: &Store, id: &str, auth: &AuthUser) -> Result<EntryRecord, ConnectError> {
    let e = require_entry(store, id).await?;
    require_member(store, &e.project_id, auth).await?;
    if e.user_id == auth.id || auth.is_admin() {
        Ok(e)
    } else {
        Err(ConnectError::new_permission_denied(
            "only the entry's author can change it",
        ))
    }
}

async fn start_timer(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::StartTimerRequest>,
) -> Result<ConnectResponse<pb::TimeEntry>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let project = task_scope(&store, &r.task_id, &auth).await?;
    let date = work_date(r.date)?;
    let note = clean_note(r.note)?;
    let pid = time_record::start_timer(
        &store,
        NewEntry {
            task_id: &r.task_id,
            project_id: &project,
            user_id: &auth.id,
            work_date: &date,
            note: &note,
            now: &now_iso(),
        },
    )
    .await
    .map_err(internal)?;
    let e = require_entry(&store, &pid.to_string()).await?;
    Ok(ConnectResponse::new(to_proto(&e)))
}

async fn stop_timer(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    _req: ConnectRequest<pb::StopTimerRequest>,
) -> Result<ConnectResponse<pb::StopTimerResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let stopped = time_record::stop_timer(&store, &auth.id, &now_iso())
        .await
        .map_err(internal)?;
    let entry = match stopped {
        Some(pid) => Some(to_proto(&require_entry(&store, &pid.to_string()).await?)),
        None => None,
    };
    Ok(ConnectResponse::new(pb::StopTimerResponse { entry }))
}

async fn get_running_timer(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    _req: ConnectRequest<pb::GetRunningTimerRequest>,
) -> Result<ConnectResponse<pb::GetRunningTimerResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let entry = running_for(&store, &auth.id).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::GetRunningTimerResponse {
        entry: entry.as_ref().map(to_proto),
    }))
}

/// Log minutes on a task by hand. Member-gated through the task's project.
pub async fn log_time_core(
    store: &Store,
    auth: &AuthUser,
    r: pb::LogTimeRequest,
) -> Result<pb::TimeEntry, ConnectError> {
    let project = task_scope(store, &r.task_id, auth).await?;
    if !entry_minutes_ok(r.minutes) {
        return Err(ConnectError::new_invalid_argument(
            "minutes must be between 1 and 1440",
        ));
    }
    let date = work_date(r.date)?;
    let note = clean_note(r.note)?;
    let pid = time_record::log_time(
        store,
        NewEntry {
            task_id: &r.task_id,
            project_id: &project,
            user_id: &auth.id,
            work_date: &date,
            note: &note,
            now: &now_iso(),
        },
        r.minutes,
    )
    .await
    .map_err(internal)?;
    let e = require_entry(store, &pid.to_string()).await?;
    Ok(to_proto(&e))
}

async fn log_time(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::LogTimeRequest>,
) -> Result<ConnectResponse<pb::TimeEntry>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    Ok(ConnectResponse::new(log_time_core(&store, &auth, r).await?))
}

async fn list_time_entries(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListTimeEntriesRequest>,
) -> Result<ConnectResponse<pb::ListTimeEntriesResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let nonempty = |s: Option<String>| s.filter(|v| !v.is_empty());
    let (task_id, project_id, user_id) = (nonempty(r.task_id), nonempty(r.project_id), nonempty(r.user_id));
    for d in [&r.from, &r.to].into_iter().flatten() {
        if !d.is_empty() && !date_ok(d) {
            return Err(ConnectError::new_invalid_argument("from/to must be yyyy-MM-dd"));
        }
    }
    let mut projects = None;
    if let Some(t) = &task_id {
        task_scope(&store, t, &auth).await?;
    } else if let Some(p) = &project_id {
        require_member(&store, p, &auth).await?;
    } else if user_id.is_some() {
        // Someone's entries across projects: only where the caller is a member.
        if !auth.is_admin() {
            projects = Some(member_project_ids(&store, &auth.id).await.map_err(internal)?);
        }
    } else {
        return Err(ConnectError::new_invalid_argument(
            "task_id, project_id or user_id is required",
        ));
    }
    let entries = time_record::list_entries(
        &store,
        EntryFilter {
            task_id,
            project_id,
            user_id,
            from: nonempty(r.from),
            to: nonempty(r.to),
            before: None,
            projects,
            finished_only: false,
        },
    )
    .await
    .map_err(internal)?;
    Ok(ConnectResponse::new(pb::ListTimeEntriesResponse {
        entries: entries.iter().map(to_proto).collect(),
    }))
}

async fn update_time_entry(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::UpdateTimeEntryRequest>,
) -> Result<ConnectResponse<pb::TimeEntry>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let e = own_entry(&store, &r.id, &auth).await?;
    if e.running && (r.minutes.is_some() || r.date.is_some()) {
        return Err(ConnectError::new_failed_precondition(
            "stop the timer before changing its time",
        ));
    }
    if r.minutes.is_some_and(|m| !entry_minutes_ok(m)) {
        return Err(ConnectError::new_invalid_argument(
            "minutes must be between 1 and 1440",
        ));
    }
    let date = match r.date {
        Some(d) if !date_ok(&d) => {
            return Err(ConnectError::new_invalid_argument("date must be yyyy-MM-dd"))
        }
        other => other,
    };
    let note = match r.note {
        Some(n) => Some(clean_note(Some(n))?),
        None => None,
    };
    time_record::update_entry(&store, e.pid, r.minutes, date, note)
        .await
        .map_err(internal)?;
    let e = require_entry(&store, &r.id).await?;
    Ok(ConnectResponse::new(to_proto(&e)))
}

async fn delete_time_entry(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::DeleteTimeEntryRequest>,
) -> Result<ConnectResponse<pb::DeleteTimeEntryResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let e = own_entry(&store, &r.id, &auth).await?;
    time_record::delete_entry(&store, e.pid).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::DeleteTimeEntryResponse { ok: true }))
}

/// TimeService router; injects the Store as a request extension.
pub fn time_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    TimeServiceBuilder::<()>::new()
        .start_timer::<_, (StoreExt, A, ConnectRequest<pb::StartTimerRequest>)>(start_timer)
        .stop_timer::<_, (StoreExt, A, ConnectRequest<pb::StopTimerRequest>)>(stop_timer)
        .get_running_timer::<_, (StoreExt, A, ConnectRequest<pb::GetRunningTimerRequest>)>(get_running_timer)
        .log_time::<_, (StoreExt, A, ConnectRequest<pb::LogTimeRequest>)>(log_time)
        .list_time_entries::<_, (StoreExt, A, ConnectRequest<pb::ListTimeEntriesRequest>)>(list_time_entries)
        .update_time_entry::<_, (StoreExt, A, ConnectRequest<pb::UpdateTimeEntryRequest>)>(update_time_entry)
        .delete_time_entry::<_, (StoreExt, A, ConnectRequest<pb::DeleteTimeEntryRequest>)>(delete_time_entry)
        .build()
        .layer(Extension(store))
}
