//! Automation rows: rules (`cmp_automation`), their runs
//! (`cmp_automationrun`) and the once-per-due-date claims of the time-based
//! rules (`cmp_automationfired`).

use domain::automation::{Action, Conditions, Trigger};
use persistence::{entity, Store};
use sqlx::postgres::PgRow;
use sqlx::Row;

#[derive(Debug, Clone)]
pub(crate) struct RuleRecord {
    pub pid: i64,
    pub project_id: String,
    pub name: String,
    pub enabled: bool,
    /// `None` when the stored JSON no longer parses: the rule never runs.
    pub trigger: Option<Trigger>,
    pub conditions: Conditions,
    pub actions: Vec<Action>,
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
    pub run_count: i64,
    pub last_run_at: Option<String>,
}

const SELECT_RULE: &str = "SELECT a.pid, a.project_id, a.name, a.enabled, a.trigger, a.conditions, \
       a.actions, a.created_by, a.created_at, a.updated_at, \
       (SELECT count(*) FROM cmp_automationrun r WHERE r.automation_id = a.pid::text) AS run_count, \
       (SELECT max(r.created_at) FROM cmp_automationrun r WHERE r.automation_id = a.pid::text) AS last_run_at \
    FROM cmp_automation a";

fn read_rule(row: &PgRow) -> sqlx::Result<RuleRecord> {
    let trigger: String = row.try_get("trigger")?;
    let conditions: String = row.try_get("conditions")?;
    let actions: String = row.try_get("actions")?;
    let parsed_actions = serde_json::from_str::<Vec<Action>>(&actions).ok();
    Ok(RuleRecord {
        pid: row.try_get("pid")?,
        project_id: row.try_get("project_id")?,
        name: row.try_get("name")?,
        enabled: row.try_get("enabled")?,
        // A rule whose actions do not parse is as broken as a bad trigger.
        trigger: serde_json::from_str(&trigger).ok().filter(|_| parsed_actions.is_some()),
        conditions: serde_json::from_str(&conditions).unwrap_or_default(),
        actions: parsed_actions.unwrap_or_default(),
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        run_count: row.try_get("run_count")?,
        last_run_at: row.try_get("last_run_at")?,
    })
}

fn read_all(rows: &[PgRow]) -> anyhow::Result<Vec<RuleRecord>> {
    rows.iter().map(read_rule).collect::<sqlx::Result<_>>().map_err(Into::into)
}

pub(crate) async fn load_rule(store: &Store, pid: i64) -> anyhow::Result<Option<RuleRecord>> {
    let row = sqlx::query(&format!("{SELECT_RULE} WHERE a.pid = $1"))
        .bind(pid)
        .fetch_optional(store.pool())
        .await?;
    Ok(match row {
        Some(r) => Some(read_rule(&r)?),
        None => None,
    })
}

/// A project's rules, oldest first (the order they run in).
pub(crate) async fn rules_for_project(store: &Store, project_id: &str) -> anyhow::Result<Vec<RuleRecord>> {
    let rows = sqlx::query(&format!("{SELECT_RULE} WHERE a.project_id = $1 ORDER BY a.pid"))
        .bind(project_id)
        .fetch_all(store.pool())
        .await?;
    read_all(&rows)
}

/// Enabled rules of a project whose trigger is one of `kinds`.
pub(crate) async fn enabled_rules(
    store: &Store,
    project_id: Option<&str>,
    kinds: &[&str],
) -> anyhow::Result<Vec<RuleRecord>> {
    let kinds: Vec<String> = kinds.iter().map(|k| k.to_string()).collect();
    let rows = sqlx::query(&format!(
        "{SELECT_RULE} WHERE a.enabled AND a.trigger_kind = ANY($2) \
         AND ($1::text IS NULL OR a.project_id = $1) ORDER BY a.pid"
    ))
    .bind(project_id)
    .bind(kinds)
    .fetch_all(store.pool())
    .await?;
    read_all(&rows)
}

pub(crate) struct RuleFields<'a> {
    pub name: &'a str,
    pub trigger: &'a Trigger,
    pub conditions: &'a Conditions,
    pub actions: &'a [Action],
    pub now: &'a str,
}

fn json<T: serde::Serialize>(v: &T) -> anyhow::Result<String> {
    Ok(serde_json::to_string(v)?)
}

pub(crate) async fn create_rule(
    store: &Store,
    project_id: &str,
    created_by: &str,
    enabled: bool,
    f: RuleFields<'_>,
) -> anyhow::Result<i64> {
    let mut tx = store.pool().begin().await?;
    let pid = entity::new_pid(&mut tx).await?;
    sqlx::query(
        "INSERT INTO cmp_automation (pid, project_id, name, enabled, trigger_kind, trigger, \
         conditions, actions, created_by, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)",
    )
    .bind(pid)
    .bind(project_id)
    .bind(f.name)
    .bind(enabled)
    .bind(f.trigger.kind())
    .bind(json(f.trigger)?)
    .bind(json(f.conditions)?)
    .bind(json(&f.actions)?)
    .bind(created_by)
    .bind(f.now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(pid)
}

pub(crate) async fn update_rule(store: &Store, pid: i64, f: RuleFields<'_>) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if !entity::touch(&mut tx, pid).await? {
        return Ok(());
    }
    sqlx::query(
        "UPDATE cmp_automation SET name = $2, trigger_kind = $3, trigger = $4, conditions = $5, \
         actions = $6, updated_at = $7 WHERE pid = $1",
    )
    .bind(pid)
    .bind(f.name)
    .bind(f.trigger.kind())
    .bind(json(f.trigger)?)
    .bind(json(f.conditions)?)
    .bind(json(&f.actions)?)
    .bind(f.now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn set_enabled(store: &Store, pid: i64, enabled: bool, now: &str) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if entity::touch(&mut tx, pid).await? {
        sqlx::query("UPDATE cmp_automation SET enabled = $2, updated_at = $3 WHERE pid = $1")
            .bind(pid)
            .bind(enabled)
            .bind(now)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Delete a rule with its runs and claims.
pub(crate) async fn delete_rule(store: &Store, pid: i64) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    sqlx::query(
        "DELETE FROM arke_entities WHERE pid IN ( \
             SELECT pid FROM cmp_automationrun WHERE automation_id = $1 \
             UNION ALL SELECT pid FROM cmp_automationfired WHERE automation_id = $1)",
    )
    .bind(pid.to_string())
    .execute(&mut *tx)
    .await?;
    entity::delete(&mut tx, pid).await?;
    tx.commit().await?;
    Ok(())
}

// ── Runs ─────────────────────────────────────────────────────────────────────

pub(crate) struct NewRun<'a> {
    pub automation_id: i64,
    pub project_id: &'a str,
    pub task_id: &'a str,
    pub trigger_kind: &'a str,
    pub status: &'a str,
    pub detail: &'a str,
    pub now: &'a str,
}

pub(crate) async fn insert_run(store: &Store, r: NewRun<'_>) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    let pid = entity::new_pid(&mut tx).await?;
    sqlx::query(
        "INSERT INTO cmp_automationrun (pid, automation_id, project_id, task_id, trigger_kind, \
         status, detail, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(pid)
    .bind(r.automation_id.to_string())
    .bind(r.project_id)
    .bind(r.task_id)
    .bind(r.trigger_kind)
    .bind(r.status)
    .bind(r.detail)
    .bind(r.now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

#[derive(Debug, Clone)]
pub(crate) struct RunRecord {
    pub pid: i64,
    pub automation_id: String,
    pub automation_name: String,
    pub task_id: String,
    pub task_title: String,
    pub task_number: i32,
    pub trigger_kind: String,
    pub status: String,
    pub detail: String,
    pub created_at: String,
}

/// Newest first.
pub(crate) async fn runs(
    store: &Store,
    project_id: &str,
    automation_id: Option<&str>,
    limit: i64,
) -> anyhow::Result<Vec<RunRecord>> {
    let rows = sqlx::query(
        "SELECT r.pid, r.automation_id, COALESCE(a.name, '') AS automation_name, r.task_id, \
                COALESCE(i.title, '') AS task_title, COALESCE(n.value, 0) AS task_number, \
                r.trigger_kind, r.status, r.detail, r.created_at \
         FROM cmp_automationrun r \
         LEFT JOIN cmp_automation a ON a.pid::text = r.automation_id \
         LEFT JOIN cmp_taskinfo i ON i.pid::text = r.task_id \
         LEFT JOIN cmp_tasknumber n ON n.pid::text = r.task_id \
         WHERE r.project_id = $1 AND ($2::text IS NULL OR r.automation_id = $2) \
         ORDER BY r.pid DESC LIMIT $3",
    )
    .bind(project_id)
    .bind(automation_id)
    .bind(limit)
    .fetch_all(store.pool())
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(RunRecord {
            pid: row.try_get("pid")?,
            automation_id: row.try_get("automation_id")?,
            automation_name: row.try_get("automation_name")?,
            task_id: row.try_get("task_id")?,
            task_title: row.try_get("task_title")?,
            task_number: row.try_get("task_number")?,
            trigger_kind: row.try_get("trigger_kind")?,
            status: row.try_get("status")?,
            detail: row.try_get("detail")?,
            created_at: row.try_get("created_at")?,
        });
    }
    Ok(out)
}

// ── Time-based ───────────────────────────────────────────────────────────────

/// Open tasks of `project_id` (To Do / In Progress) whose due date (as a day)
/// is in `[from, to]`, with that day.
pub(crate) async fn open_tasks_due_between(
    store: &Store,
    project_id: &str,
    from: Option<&str>,
    to: &str,
) -> anyhow::Result<Vec<(i64, String)>> {
    let rows = sqlx::query(
        "SELECT i.pid, LEFT(i.due_date, 10) AS due FROM cmp_taskinfo i \
         JOIN cmp_taskmoduleref m ON m.pid = i.pid \
         JOIN cmp_moduleprojectref mp ON mp.pid::text = m.module_id AND mp.project_id = $1 \
         WHERE i.status IN ('todo', 'in_progress') AND i.due_date IS NOT NULL AND i.due_date <> '' \
           AND ($2::text IS NULL OR LEFT(i.due_date, 10) >= $2) AND LEFT(i.due_date, 10) <= $3 \
         ORDER BY i.pid",
    )
    .bind(project_id)
    .bind(from)
    .bind(to)
    .fetch_all(store.pool())
    .await?;
    rows.iter()
        .map(|r| Ok((r.try_get("pid")?, r.try_get("due")?)))
        .collect::<sqlx::Result<_>>()
        .map_err(Into::into)
}

/// Claim (rule, task, due date) for a time-based run. `true` when this call
/// claimed it; `false` when it already ran — safe across instances.
pub(crate) async fn claim_fired(
    store: &Store,
    automation_id: i64,
    task_id: &str,
    due_date: &str,
) -> anyhow::Result<bool> {
    let mut tx = store.pool().begin().await?;
    let taken: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM cmp_automationfired \
         WHERE automation_id = $1 AND task_id = $2 AND due_date = $3)",
    )
    .bind(automation_id.to_string())
    .bind(task_id)
    .bind(due_date)
    .fetch_one(&mut *tx)
    .await?;
    if taken {
        return Ok(false);
    }
    let pid = entity::new_pid(&mut tx).await?;
    let inserted = sqlx::query(
        "INSERT INTO cmp_automationfired (pid, automation_id, task_id, due_date) \
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
    )
    .bind(pid)
    .bind(automation_id.to_string())
    .bind(task_id)
    .bind(due_date)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if inserted == 0 {
        // Lost the race: the entity row goes with the rollback.
        return Ok(false);
    }
    tx.commit().await?;
    Ok(true)
}

/// Every open subtask of `parent_id` is done (cancelled ones aside), and it
/// has at least one done.
pub(crate) async fn all_subtasks_done(store: &Store, parent_id: &str) -> anyhow::Result<bool> {
    let (open, done): (i64, i64) = sqlx::query_as(
        "SELECT count(*) FILTER (WHERE i.status IN ('todo', 'in_progress')), \
                count(*) FILTER (WHERE i.status = 'done') \
         FROM cmp_taskparent p JOIN cmp_taskinfo i ON i.pid = p.pid WHERE p.parent_id = $1",
    )
    .bind(parent_id)
    .fetch_one(store.pool())
    .await?;
    Ok(open == 0 && done > 0)
}
