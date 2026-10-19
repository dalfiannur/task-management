//! Time-entry rows ↔ proto, plus every read and write the time flows make.
//!
//! Plain sqlx over `cmp_timeentry`. A partial unique index keeps one running
//! timer per user; starting one stops the other in the same transaction.

use domain::time::timer_minutes;
use persistence::{entity, Store};
use sqlx::postgres::PgRow;
use sqlx::{PgConnection, Row};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::sedjiwa::tasks::time::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct EntryRecord {
    pub pid: i64,
    pub task_id: String,
    pub project_id: String,
    pub user_id: String,
    pub work_date: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub running: bool,
    pub minutes: i32,
    pub note: String,
    pub created_at: String,
    pub task_title: String,
    pub task_number: i32,
}

/// The entry plus its task's title and number (empty / 0 once deleted).
const SELECT_ENTRY: &str = "SELECT e.pid, e.task_id, e.project_id, e.user_id, e.work_date, \
       e.started_at, e.ended_at, e.running, e.minutes, e.note, e.created_at, \
       COALESCE(ti.title, '') AS task_title, COALESCE(tn.value, 0) AS task_number \
    FROM cmp_timeentry e \
    LEFT JOIN cmp_taskinfo ti ON ti.pid::text = e.task_id \
    LEFT JOIN cmp_tasknumber tn ON tn.pid::text = e.task_id";

fn read_entry(row: &PgRow) -> sqlx::Result<EntryRecord> {
    Ok(EntryRecord {
        pid: row.try_get("pid")?,
        task_id: row.try_get("task_id")?,
        project_id: row.try_get("project_id")?,
        user_id: row.try_get("user_id")?,
        work_date: row.try_get("work_date")?,
        started_at: row.try_get("started_at")?,
        ended_at: row.try_get("ended_at")?,
        running: row.try_get("running")?,
        minutes: row.try_get("minutes")?,
        note: row.try_get("note")?,
        created_at: row.try_get("created_at")?,
        task_title: row.try_get("task_title")?,
        task_number: row.try_get("task_number")?,
    })
}

pub(crate) fn to_proto(e: &EntryRecord) -> pb::TimeEntry {
    pb::TimeEntry {
        id: e.pid.to_string(),
        task_id: e.task_id.clone(),
        project_id: e.project_id.clone(),
        user_id: e.user_id.clone(),
        date: e.work_date.clone(),
        started_at: e.started_at.clone(),
        ended_at: e.ended_at.clone(),
        minutes: e.minutes,
        note: e.note.clone(),
        created_at: e.created_at.clone(),
        running: e.running,
        task_title: e.task_title.clone(),
        task_number: e.task_number,
    }
}

pub(crate) fn now_iso() -> String {
    OffsetDateTime::now_utc().format(&Rfc3339).unwrap_or_default()
}

pub(crate) fn today() -> String {
    now_iso().chars().take(10).collect()
}

// ── Reads ────────────────────────────────────────────────────────────────────

pub(crate) async fn load_entry(store: &Store, pid: i64) -> anyhow::Result<Option<EntryRecord>> {
    let row = sqlx::query(&format!("{SELECT_ENTRY} WHERE e.pid = $1"))
        .bind(pid)
        .fetch_optional(store.pool())
        .await?;
    Ok(row.as_ref().map(read_entry).transpose()?)
}

pub(crate) async fn running_for(store: &Store, user_id: &str) -> anyhow::Result<Option<EntryRecord>> {
    let row = sqlx::query(&format!("{SELECT_ENTRY} WHERE e.user_id = $1 AND e.running"))
        .bind(user_id)
        .fetch_optional(store.pool())
        .await?;
    Ok(row.as_ref().map(read_entry).transpose()?)
}

/// What a list may filter by. `projects` (when set) bounds the result to the
/// caller's projects.
#[derive(Default)]
pub(crate) struct EntryFilter {
    pub task_id: Option<String>,
    pub project_id: Option<String>,
    pub user_id: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    /// Exclusive upper bound, for half-open report windows.
    pub before: Option<String>,
    pub projects: Option<Vec<String>>,
    /// Leave out running timers (their minutes are not known yet).
    pub finished_only: bool,
}

/// Newest day first; within a day, newest entry first.
pub(crate) async fn list_entries(store: &Store, f: EntryFilter) -> anyhow::Result<Vec<EntryRecord>> {
    let rows = sqlx::query(&format!(
        "{SELECT_ENTRY} WHERE ($1::text IS NULL OR e.task_id = $1) \
           AND ($2::text IS NULL OR e.project_id = $2) \
           AND ($3::text IS NULL OR e.user_id = $3) \
           AND ($4::text IS NULL OR e.work_date >= $4) \
           AND ($5::text IS NULL OR e.work_date <= $5) \
           AND ($6::text[] IS NULL OR e.project_id = ANY($6)) \
           AND ($7::text IS NULL OR e.work_date < $7) \
           AND ($8 OR NOT e.running) \
         ORDER BY e.work_date DESC, e.pid DESC"
    ))
    .bind(f.task_id)
    .bind(f.project_id)
    .bind(f.user_id)
    .bind(f.from)
    .bind(f.to)
    .bind(f.projects)
    .bind(f.before)
    .bind(!f.finished_only)
    .fetch_all(store.pool())
    .await?;
    Ok(rows.iter().map(read_entry).collect::<sqlx::Result<_>>()?)
}

/// Finished minutes per (project, user) with `work_date` in `[from, before)` —
/// what the period report adds up. `projects` = None means every project.
pub(crate) async fn minutes_by_project_user(
    store: &Store,
    from: &str,
    before: &str,
    projects: Option<&[String]>,
) -> anyhow::Result<Vec<(String, String, i64)>> {
    let rows = sqlx::query(
        "SELECT project_id, user_id, SUM(minutes)::int8 AS minutes FROM cmp_timeentry \
         WHERE NOT running AND work_date >= $1 AND work_date < $2 \
           AND ($3::text[] IS NULL OR project_id = ANY($3)) \
         GROUP BY project_id, user_id",
    )
    .bind(from)
    .bind(before)
    .bind(projects.map(|p| p.to_vec()))
    .fetch_all(store.pool())
    .await?;
    rows.iter()
        .map(|r| Ok((r.try_get("project_id")?, r.try_get("user_id")?, r.try_get("minutes")?)))
        .collect::<sqlx::Result<_>>()
        .map_err(Into::into)
}

// ── Writes ───────────────────────────────────────────────────────────────────

/// Stop `user_id`'s running timer, if any: its minutes are the elapsed time.
/// Returns the stopped entry's pid.
async fn stop_running(conn: &mut PgConnection, user_id: &str, now: &str) -> anyhow::Result<Option<i64>> {
    let row = sqlx::query(
        "SELECT pid, started_at FROM cmp_timeentry WHERE user_id = $1 AND running FOR UPDATE",
    )
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(row) = row else { return Ok(None) };
    let pid: i64 = row.try_get("pid")?;
    let started: Option<String> = row.try_get("started_at")?;
    let elapsed = match (started.as_deref().map(|s| OffsetDateTime::parse(s, &Rfc3339)), OffsetDateTime::parse(now, &Rfc3339)) {
        (Some(Ok(s)), Ok(n)) => (n - s).whole_seconds(),
        _ => 0,
    };
    sqlx::query("UPDATE cmp_timeentry SET running = false, ended_at = $2, minutes = $3::int4 WHERE pid = $1")
        .bind(pid)
        .bind(now)
        .bind(timer_minutes(elapsed))
        .execute(&mut *conn)
        .await?;
    entity::touch(conn, pid).await?;
    Ok(Some(pid))
}

pub(crate) struct NewEntry<'a> {
    pub task_id: &'a str,
    pub project_id: &'a str,
    pub user_id: &'a str,
    pub work_date: &'a str,
    pub note: &'a str,
    pub now: &'a str,
}

async fn insert_entry(
    conn: &mut PgConnection,
    e: &NewEntry<'_>,
    running: bool,
    minutes: i32,
) -> sqlx::Result<i64> {
    let pid = entity::new_pid(conn).await?;
    sqlx::query(
        "INSERT INTO cmp_timeentry (pid, task_id, project_id, user_id, work_date, started_at, \
         ended_at, running, minutes, note, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8::int4, $9, $10)",
    )
    .bind(pid)
    .bind(e.task_id)
    .bind(e.project_id)
    .bind(e.user_id)
    .bind(e.work_date)
    .bind(running.then_some(e.now))
    .bind(running)
    .bind(minutes)
    .bind(e.note)
    .bind(e.now)
    .execute(conn)
    .await?;
    Ok(pid)
}

/// Start a timer on a task, stopping whatever the user had running. Returns
/// the new entry and the one it stopped, if any.
pub(crate) async fn start_timer(store: &Store, e: NewEntry<'_>) -> anyhow::Result<(i64, Option<i64>)> {
    let mut tx = store.pool().begin().await?;
    // Serialise per user: two starts at once must not both pass the stop.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('cmp_timeentry:' || $1))")
        .bind(e.user_id)
        .execute(&mut *tx)
        .await?;
    let stopped = stop_running(&mut tx, e.user_id, e.now).await?;
    let pid = insert_entry(&mut tx, &e, true, 0).await?;
    tx.commit().await?;
    Ok((pid, stopped))
}

pub(crate) async fn stop_timer(store: &Store, user_id: &str, now: &str) -> anyhow::Result<Option<i64>> {
    let mut tx = store.pool().begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('cmp_timeentry:' || $1))")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    let pid = stop_running(&mut tx, user_id, now).await?;
    tx.commit().await?;
    Ok(pid)
}

pub(crate) async fn log_time(store: &Store, e: NewEntry<'_>, minutes: i32) -> anyhow::Result<i64> {
    let mut tx = store.pool().begin().await?;
    let pid = insert_entry(&mut tx, &e, false, minutes).await?;
    tx.commit().await?;
    Ok(pid)
}

/// Set the fields that are `Some`; leave the rest.
pub(crate) async fn update_entry(
    store: &Store,
    pid: i64,
    minutes: Option<i32>,
    work_date: Option<String>,
    note: Option<String>,
) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if entity::touch(&mut tx, pid).await? {
        sqlx::query(
            "UPDATE cmp_timeentry SET minutes = COALESCE($2::int4, minutes), \
             work_date = COALESCE($3, work_date), note = COALESCE($4, note) WHERE pid = $1",
        )
        .bind(pid)
        .bind(minutes)
        .bind(work_date)
        .bind(note)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
    }
    Ok(())
}

pub(crate) async fn delete_entry(store: &Store, pid: i64) -> anyhow::Result<()> {
    let mut conn = store.pool().acquire().await?;
    entity::delete(&mut conn, pid).await?;
    Ok(())
}

/// Remove the time entries (a running timer included) of `task_ids`, inside
/// the caller's delete transaction. Entries are their own entities keyed by a
/// text id, so the task's cascade does not reach them.
pub(crate) async fn delete_entries_for_tasks(conn: &mut PgConnection, task_ids: &[String]) -> sqlx::Result<()> {
    sqlx::query(
        "DELETE FROM arke_entities WHERE pid IN \
         (SELECT pid FROM cmp_timeentry WHERE task_id = ANY($1))",
    )
    .bind(task_ids)
    .execute(conn)
    .await?;
    Ok(())
}

/// Remove every time entry of `project_id`, inside the caller's transaction.
pub(crate) async fn delete_entries_for_project(conn: &mut PgConnection, project_id: &str) -> sqlx::Result<()> {
    sqlx::query(
        "DELETE FROM arke_entities WHERE pid IN \
         (SELECT pid FROM cmp_timeentry WHERE project_id = $1)",
    )
    .bind(project_id)
    .execute(conn)
    .await?;
    Ok(())
}
