//! Calendar rows and the reads the workload is computed from.
//!
//! `cmp_workcalendar` hangs off a project or user entity (NULL columns =
//! inherit / default). The global days live on the one `cmp_workspacesettings`
//! entity, created on first write.

use std::collections::HashMap;

use domain::workload::DEFAULT_DAYS;
use persistence::{entity, Store};
use sqlx::Row;

/// A project's or user's own setting.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct CalendarRow {
    pub working_days: Option<i32>,
    pub weekly_minutes: Option<i32>,
}

/// One open, estimated task with what the workload needs of it.
#[derive(Debug, Clone)]
pub(crate) struct OpenTask {
    pub pid: i64,
    pub project_id: String,
    pub number: i32,
    pub title: String,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    pub estimate: i32,
    pub logged: i64,
    pub assignees: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct Person {
    pub name: String,
    pub avatar_url: String,
}

// ── Reads ────────────────────────────────────────────────────────────────────

pub(crate) async fn global_days(store: &Store) -> anyhow::Result<i32> {
    let days: Option<i32> =
        sqlx::query_scalar("SELECT working_days FROM cmp_workspacesettings WHERE singleton")
            .fetch_optional(store.pool())
            .await?;
    Ok(days.unwrap_or(DEFAULT_DAYS))
}

pub(crate) async fn calendars(
    store: &Store,
    pids: &[i64],
) -> anyhow::Result<HashMap<i64, CalendarRow>> {
    let rows = sqlx::query(
        "SELECT pid, working_days, weekly_minutes FROM cmp_workcalendar WHERE pid = ANY($1)",
    )
    .bind(pids)
    .fetch_all(store.pool())
    .await?;
    let mut out = HashMap::with_capacity(rows.len());
    for row in rows {
        out.insert(
            row.try_get("pid")?,
            CalendarRow {
                working_days: row.try_get("working_days")?,
                weekly_minutes: row.try_get("weekly_minutes")?,
            },
        );
    }
    Ok(out)
}

pub(crate) async fn calendar(store: &Store, pid: i64) -> anyhow::Result<CalendarRow> {
    Ok(calendars(store, &[pid]).await?.remove(&pid).unwrap_or_default())
}

/// True if `pid` is a user (has a phone) — the `USER` calendar's target.
pub(crate) async fn is_user(store: &Store, pid: i64) -> anyhow::Result<bool> {
    Ok(sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM cmp_userphone WHERE pid = $1)")
        .bind(pid)
        .fetch_one(store.pool())
        .await?)
}

/// Distinct member ids of `projects`.
pub(crate) async fn members_of(store: &Store, projects: &[String]) -> anyhow::Result<Vec<String>> {
    Ok(sqlx::query_scalar(
        "SELECT DISTINCT user_id FROM cmp_projectmembership WHERE project_id = ANY($1)",
    )
    .bind(projects)
    .fetch_all(store.pool())
    .await?)
}

pub(crate) async fn people(store: &Store, ids: &[i64]) -> anyhow::Result<HashMap<String, Person>> {
    let rows = sqlx::query(
        "SELECT pid, display_name, avatar_url FROM cmp_userprofile WHERE pid = ANY($1)",
    )
    .bind(ids)
    .fetch_all(store.pool())
    .await?;
    let mut out = HashMap::with_capacity(rows.len());
    for row in rows {
        let pid: i64 = row.try_get("pid")?;
        out.insert(
            pid.to_string(),
            Person { name: row.try_get("display_name")?, avatar_url: row.try_get("avatar_url")? },
        );
    }
    Ok(out)
}

pub(crate) async fn project_names(
    store: &Store,
    ids: &[i64],
) -> anyhow::Result<HashMap<String, String>> {
    let rows = sqlx::query("SELECT pid, value FROM cmp_projectname WHERE pid = ANY($1)")
        .bind(ids)
        .fetch_all(store.pool())
        .await?;
    let mut out = HashMap::with_capacity(rows.len());
    for row in rows {
        let pid: i64 = row.try_get("pid")?;
        out.insert(pid.to_string(), row.try_get("value")?);
    }
    Ok(out)
}

/// Open (To Do / In Progress category), estimated, assigned tasks of
/// `projects`, minus parents whose subtasks carry estimates — those hold the
/// effort instead. `logged` counts finished time entries only.
pub(crate) async fn open_tasks(store: &Store, projects: &[String]) -> anyhow::Result<Vec<OpenTask>> {
    let rows = sqlx::query(
        "SELECT i.pid, mp.project_id, COALESCE(tn.value, 0) AS number, i.title, \
                i.start_date, i.due_date, e.minutes AS estimate, \
                (SELECT COALESCE(SUM(te.minutes), 0)::int8 FROM cmp_timeentry te \
                 WHERE te.task_id = i.pid::text AND NOT te.running) AS logged, \
                ARRAY(SELECT jsonb_array_elements_text(a.user_ids)) AS assignees \
         FROM cmp_taskinfo i \
         JOIN cmp_taskmoduleref m ON m.pid = i.pid \
         JOIN cmp_moduleprojectref mp ON mp.pid::text = m.module_id \
         JOIN cmp_taskestimate e ON e.pid = i.pid AND e.minutes > 0 \
         JOIN cmp_taskassignees a ON a.pid = i.pid AND jsonb_array_length(a.user_ids) > 0 \
         LEFT JOIN cmp_tasknumber tn ON tn.pid = i.pid \
         WHERE mp.project_id = ANY($1) \
           AND i.status IN ('todo', 'in_progress') \
           AND NOT EXISTS ( \
               SELECT 1 FROM cmp_taskparent p \
               JOIN cmp_taskestimate se ON se.pid = p.pid AND se.minutes > 0 \
               WHERE p.parent_id = i.pid::text) \
         ORDER BY i.due_date NULLS LAST, i.pid",
    )
    .bind(projects)
    .fetch_all(store.pool())
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(OpenTask {
            pid: row.try_get("pid")?,
            project_id: row.try_get("project_id")?,
            number: row.try_get("number")?,
            title: row.try_get("title")?,
            start_date: row.try_get("start_date")?,
            due_date: row.try_get("due_date")?,
            estimate: row.try_get("estimate")?,
            logged: row.try_get("logged")?,
            assignees: row.try_get("assignees")?,
        });
    }
    Ok(out)
}

// ── Writes ───────────────────────────────────────────────────────────────────

/// Set the global days and, when given, the time zone (`Some("")` resets it
/// to the default), creating the settings entity on first write.
pub(crate) async fn set_global(store: &Store, mask: i32, timezone: Option<&str>) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('cmp_workspacesettings'))")
        .execute(&mut *tx)
        .await?;
    let pid: Option<i64> = sqlx::query_scalar("SELECT pid FROM cmp_workspacesettings WHERE singleton")
        .fetch_optional(&mut *tx)
        .await?;
    match pid {
        Some(pid) => {
            entity::touch(&mut tx, pid).await?;
            sqlx::query(
                "UPDATE cmp_workspacesettings SET working_days = $2, \
                 timezone = CASE WHEN $3::text IS NULL THEN timezone ELSE NULLIF($3, '') END \
                 WHERE pid = $1",
            )
                .bind(pid)
                .bind(mask)
                .bind(timezone)
                .execute(&mut *tx)
                .await?;
        }
        None => {
            let pid = entity::new_pid(&mut tx).await?;
            sqlx::query(
                "INSERT INTO cmp_workspacesettings (pid, working_days, timezone) VALUES ($1, $2, NULLIF($3, ''))",
            )
                .bind(pid)
                .bind(mask)
                .bind(timezone)
                .execute(&mut *tx)
                .await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

/// Replace `pid`'s calendar; all-`None` removes it (back to inheriting).
/// `false` when the entity no longer exists.
pub(crate) async fn set_calendar(store: &Store, pid: i64, row: CalendarRow) -> anyhow::Result<bool> {
    let mut tx = store.pool().begin().await?;
    if !entity::touch(&mut tx, pid).await? {
        return Ok(false);
    }
    if row.working_days.is_none() && row.weekly_minutes.is_none() {
        sqlx::query("DELETE FROM cmp_workcalendar WHERE pid = $1")
            .bind(pid)
            .execute(&mut *tx)
            .await?;
    } else {
        sqlx::query(
            "INSERT INTO cmp_workcalendar (pid, working_days, weekly_minutes) VALUES ($1, $2, $3) \
             ON CONFLICT (pid) DO UPDATE SET working_days = EXCLUDED.working_days, \
             weekly_minutes = EXCLUDED.weekly_minutes",
        )
        .bind(pid)
        .bind(row.working_days)
        .bind(row.weekly_minutes)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(true)
}
