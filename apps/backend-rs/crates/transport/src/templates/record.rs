//! Project copies and task-template rows.
//!
//! A copy runs in one transaction: the new project, then the source's
//! statuses, labels, modules and tasks with every id remapped, then the task
//! links (parent, blocked-by) that point at copied tasks. Assignees, comments,
//! time, media and pages stay behind.

use std::collections::{HashMap, HashSet};

use domain::task::TaskStatus;
use domain::template::{shift_date, TemplateSubtask};
use persistence::{entity, Store};
use sqlx::postgres::PgRow;
use sqlx::{PgConnection, Row};

use crate::projects::record::create_project_on;

/// What a copied task needs to be indexed for search.
#[derive(Debug, Clone)]
pub(crate) struct CopiedTask {
    pub pid: i64,
    pub title: String,
    pub description: String,
    pub parent_id: Option<String>,
}

pub(crate) struct NewCopy<'a> {
    pub source_id: &'a str,
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub owner_id: &'a str,
    pub creator_id: &'a str,
    /// New start date, if any; `shift` days apply to every copied date.
    pub start_date: Option<&'a str>,
    pub shift: i64,
    pub now: &'a str,
}

/// The earliest start/due date among `project_id`'s tasks: the shift base
/// for a source project without a start date.
pub(crate) async fn earliest_task_date(store: &Store, project_id: &str) -> anyhow::Result<Option<String>> {
    Ok(sqlx::query_scalar(
        "SELECT MIN(LEFT(d, 10)) FROM ( \
             SELECT i.start_date AS d FROM cmp_taskinfo i \
             JOIN cmp_taskmoduleref m ON m.pid = i.pid \
             JOIN cmp_moduleprojectref mp ON mp.pid::text = m.module_id AND mp.project_id = $1 \
             UNION ALL \
             SELECT i.due_date FROM cmp_taskinfo i \
             JOIN cmp_taskmoduleref m ON m.pid = i.pid \
             JOIN cmp_moduleprojectref mp ON mp.pid::text = m.module_id AND mp.project_id = $1 \
         ) x WHERE d IS NOT NULL AND d <> ''",
    )
    .bind(project_id)
    .fetch_one(store.pool())
    .await?)
}

struct SourceTask {
    pid: i64,
    title: String,
    description: String,
    status: String,
    priority: String,
    start_date: Option<String>,
    due_date: Option<String>,
    sort_order: i32,
    module_id: String,
    number: Option<i32>,
    parent_id: Option<String>,
    blocked_by: Vec<String>,
    label_ids: Vec<String>,
    estimate: Option<i32>,
}

fn read_source_task(row: &PgRow) -> sqlx::Result<SourceTask> {
    Ok(SourceTask {
        pid: row.try_get("pid")?,
        title: row.try_get("title")?,
        description: row.try_get("description")?,
        status: row.try_get("status")?,
        priority: row.try_get("priority")?,
        start_date: row.try_get("start_date")?,
        due_date: row.try_get("due_date")?,
        sort_order: row.try_get("sort_order")?,
        module_id: row.try_get("module_id")?,
        number: row.try_get("number")?,
        parent_id: row.try_get("parent_id")?,
        blocked_by: row.try_get("blocked_by")?,
        label_ids: row.try_get("label_ids")?,
        estimate: row.try_get("estimate")?,
    })
}

/// Create the project and copy `c.source_id` into it. Returns the new pid and
/// the copied tasks.
pub(crate) async fn copy_project(store: &Store, c: NewCopy<'_>) -> anyhow::Result<(i64, Vec<CopiedTask>)> {
    let mut tx = store.pool().begin().await?;
    let pid = create_project_on(&mut tx, c.name, c.description, c.owner_id, c.creator_id).await?;
    let dst = pid.to_string();
    let src = c.source_id;
    let shift = |d: &Option<String>| d.as_deref().filter(|s| !s.is_empty()).map(|s| shift_date(s, c.shift));

    // Project dates: the given start, and the source's end moved alike.
    if let Some(start) = c.start_date {
        let src_end: Option<String> = sqlx::query_scalar(
            "SELECT end_date FROM cmp_projectdates WHERE pid::text = $1",
        )
        .bind(src)
        .fetch_optional(&mut *tx)
        .await?
        .flatten();
        sqlx::query("INSERT INTO cmp_projectdates (pid, start_date, end_date) VALUES ($1, $2, $3)")
            .bind(pid)
            .bind(start)
            .bind(shift(&src_end))
            .execute(&mut *tx)
            .await?;
    }

    // Statuses, in workflow order.
    let rows = sqlx::query(
        "SELECT pid, name, color, category, sort_order FROM cmp_taskstatusdef \
         WHERE project_id = $1 ORDER BY sort_order, pid",
    )
    .bind(src)
    .fetch_all(&mut *tx)
    .await?;
    let mut first_todo: Option<i64> = None;
    for row in &rows {
        let new = entity::new_pid(&mut tx).await?;
        let category: String = row.try_get("category")?;
        sqlx::query(
            "INSERT INTO cmp_taskstatusdef (pid, project_id, name, color, category, sort_order) \
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(new)
        .bind(&dst)
        .bind(row.try_get::<String, _>("name")?)
        .bind(row.try_get::<String, _>("color")?)
        .bind(&category)
        .bind(row.try_get::<i32, _>("sort_order")?)
        .execute(&mut *tx)
        .await?;
        if first_todo.is_none() && category == TaskStatus::Todo.as_str() {
            first_todo = Some(new);
        }
    }
    if rows.is_empty() {
        crate::work::status_record::ensure_defaults(&mut tx, &dst).await?;
        first_todo = sqlx::query_scalar(
            "SELECT pid FROM cmp_taskstatusdef WHERE project_id = $1 AND category = 'todo' \
             ORDER BY sort_order, pid LIMIT 1",
        )
        .bind(&dst)
        .fetch_optional(&mut *tx)
        .await?;
    }

    // Labels.
    let mut labels: HashMap<String, String> = HashMap::new();
    for row in sqlx::query("SELECT pid, name, color FROM cmp_labelinfo WHERE project_id = $1 ORDER BY pid")
        .bind(src)
        .fetch_all(&mut *tx)
        .await?
    {
        let new = entity::new_pid(&mut tx).await?;
        sqlx::query("INSERT INTO cmp_labelinfo (pid, project_id, name, color) VALUES ($1, $2, $3, $4)")
            .bind(new)
            .bind(&dst)
            .bind(row.try_get::<String, _>("name")?)
            .bind(row.try_get::<String, _>("color")?)
            .execute(&mut *tx)
            .await?;
        labels.insert(row.try_get::<i64, _>("pid")?.to_string(), new.to_string());
    }

    // Modules.
    let mut modules: HashMap<String, String> = HashMap::new();
    for row in sqlx::query(
        "SELECT n.pid, n.value AS name, d.value AS description, COALESCE(o.value, 0) AS ord \
         FROM cmp_moduleprojectref p \
         JOIN cmp_modulename n ON n.pid = p.pid \
         LEFT JOIN cmp_moduledescription d ON d.pid = p.pid \
         LEFT JOIN cmp_moduleorder o ON o.pid = p.pid \
         WHERE p.project_id = $1 ORDER BY ord, n.pid",
    )
    .bind(src)
    .fetch_all(&mut *tx)
    .await?
    {
        let new = entity::new_pid(&mut tx).await?;
        sqlx::query("INSERT INTO cmp_modulename (pid, value) VALUES ($1, $2)")
            .bind(new)
            .bind(row.try_get::<String, _>("name")?)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO cmp_moduleprojectref (pid, project_id) VALUES ($1, $2)")
            .bind(new)
            .bind(&dst)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO cmp_moduleorder (pid, value) VALUES ($1, $2)")
            .bind(new)
            .bind(row.try_get::<i32, _>("ord")?)
            .execute(&mut *tx)
            .await?;
        if let Some(desc) = row.try_get::<Option<String>, _>("description")? {
            sqlx::query("INSERT INTO cmp_moduledescription (pid, value) VALUES ($1, $2)")
                .bind(new)
                .bind(desc)
                .execute(&mut *tx)
                .await?;
        }
        modules.insert(row.try_get::<i64, _>("pid")?.to_string(), new.to_string());
    }

    // Tasks: everything not cancelled, minus subtasks of a cancelled parent.
    let rows = sqlx::query(
        "SELECT i.pid, i.title, i.description, i.status, i.priority, i.start_date, i.due_date, \
                i.sort_order, m.module_id, num.value AS number, par.parent_id, \
                ARRAY(SELECT jsonb_array_elements_text(COALESCE(blk.task_ids, '[]'::jsonb))) AS blocked_by, \
                ARRAY(SELECT jsonb_array_elements_text(COALESCE(lab.label_ids, '[]'::jsonb))) AS label_ids, \
                est.minutes AS estimate \
         FROM cmp_taskinfo i \
         JOIN cmp_taskmoduleref m ON m.pid = i.pid \
         JOIN cmp_moduleprojectref mp ON mp.pid::text = m.module_id AND mp.project_id = $1 \
         LEFT JOIN cmp_tasknumber num ON num.pid = i.pid \
         LEFT JOIN cmp_taskparent par ON par.pid = i.pid \
         LEFT JOIN cmp_taskblockedby blk ON blk.pid = i.pid \
         LEFT JOIN cmp_tasklabels lab ON lab.pid = i.pid \
         LEFT JOIN cmp_taskestimate est ON est.pid = i.pid \
         ORDER BY i.pid",
    )
    .bind(src)
    .fetch_all(&mut *tx)
    .await?;
    let mut tasks = Vec::with_capacity(rows.len());
    for row in &rows {
        tasks.push(read_source_task(row)?);
    }
    let live: std::collections::HashSet<String> = tasks
        .iter()
        .filter(|t| t.status != TaskStatus::Cancelled.as_str())
        .map(|t| t.pid.to_string())
        .collect();
    tasks.retain(|t| {
        live.contains(&t.pid.to_string())
            && t.parent_id.as_ref().is_none_or(|p| live.contains(p))
            && modules.contains_key(&t.module_id)
    });

    let mut task_ids: HashMap<String, i64> = HashMap::new();
    let mut next_number = tasks.iter().filter_map(|t| t.number).max().unwrap_or(0);
    for t in &tasks {
        let new = entity::new_pid(&mut tx).await?;
        let number = match t.number {
            Some(n) => n,
            None => {
                next_number += 1;
                next_number
            }
        };
        sqlx::query("INSERT INTO cmp_tasknumber (pid, project_id, value) VALUES ($1, $2, $3)")
            .bind(new)
            .bind(&dst)
            .bind(number)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT INTO cmp_taskinfo (pid, title, description, status, priority, start_date, due_date, sort_order) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(new)
        .bind(&t.title)
        .bind(&t.description)
        .bind(TaskStatus::Todo.as_str())
        .bind(&t.priority)
        .bind(shift(&t.start_date))
        .bind(shift(&t.due_date))
        .bind(t.sort_order)
        .execute(&mut *tx)
        .await?;
        sqlx::query("INSERT INTO cmp_taskmoduleref (pid, module_id) VALUES ($1, $2)")
            .bind(new)
            .bind(&modules[&t.module_id])
            .execute(&mut *tx)
            .await?;
        let label_ids: Vec<String> = t.label_ids.iter().filter_map(|l| labels.get(l).cloned()).collect();
        sqlx::query("INSERT INTO cmp_taskassignees (pid, user_ids) VALUES ($1, '[]'::jsonb)")
            .bind(new)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO cmp_tasklabels (pid, label_ids) VALUES ($1, to_jsonb($2::text[]))")
            .bind(new)
            .bind(label_ids)
            .execute(&mut *tx)
            .await?;
        if let Some(s) = first_todo {
            sqlx::query("INSERT INTO cmp_taskstatusref (pid, status_id) VALUES ($1, $2)")
                .bind(new)
                .bind(s.to_string())
                .execute(&mut *tx)
                .await?;
        }
        if let Some(m) = t.estimate {
            sqlx::query("INSERT INTO cmp_taskestimate (pid, minutes) VALUES ($1, $2)")
                .bind(new)
                .bind(m)
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query(
            "INSERT INTO cmp_taskaudit (pid, created_at, updated_at, completed_at, created_by) \
             VALUES ($1, $2, $2, NULL, $3)",
        )
        .bind(new)
        .bind(c.now)
        .bind(c.creator_id)
        .execute(&mut *tx)
        .await?;
        task_ids.insert(t.pid.to_string(), new);
    }

    // Links between copied tasks.
    let mut copied = Vec::with_capacity(tasks.len());
    for t in &tasks {
        let new = task_ids[&t.pid.to_string()];
        let parent = t.parent_id.as_ref().and_then(|p| task_ids.get(p)).map(|p| p.to_string());
        if let Some(p) = &parent {
            sqlx::query("INSERT INTO cmp_taskparent (pid, parent_id) VALUES ($1, $2)")
                .bind(new)
                .bind(p)
                .execute(&mut *tx)
                .await?;
        }
        let blocked: Vec<String> =
            t.blocked_by.iter().filter_map(|b| task_ids.get(b)).map(|b| b.to_string()).collect();
        if !blocked.is_empty() {
            sqlx::query("INSERT INTO cmp_taskblockedby (pid, task_ids) VALUES ($1, to_jsonb($2::text[]))")
                .bind(new)
                .bind(blocked)
                .execute(&mut *tx)
                .await?;
        }
        copied.push(CopiedTask {
            pid: new,
            title: t.title.clone(),
            description: t.description.clone(),
            parent_id: parent,
        });
    }

    // Working days.
    sqlx::query(
        "INSERT INTO cmp_workcalendar (pid, working_days, weekly_minutes) \
         SELECT $1, working_days, NULL FROM cmp_workcalendar \
         WHERE pid::text = $2 AND working_days IS NOT NULL",
    )
    .bind(pid)
    .bind(src)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok((pid, copied))
}

// ── Task templates ───────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub(crate) struct TemplateRecord {
    pub pid: i64,
    pub project_id: String,
    pub name: String,
    pub title: String,
    pub description: String,
    pub priority: String,
    pub estimate_minutes: Option<i32>,
    pub label_ids: Vec<String>,
    pub subtasks: Vec<TemplateSubtask>,
    pub created_by: String,
    pub created_at: String,
}

/// Subtasks are stored as JSONB objects (`{"title": …}`); rows written before
/// that hold plain strings, which still read as titles.
const SELECT_TEMPLATE: &str = "SELECT pid, project_id, name, title, description, priority, \
       estimate_minutes, \
       ARRAY(SELECT jsonb_array_elements_text(label_ids)) AS label_ids, \
       ARRAY(SELECT CASE jsonb_typeof(e) WHEN 'string' THEN e #>> '{}' ELSE e ->> 'title' END \
             FROM jsonb_array_elements(subtasks) WITH ORDINALITY AS x(e, n) ORDER BY n) AS subtasks, \
       created_by, created_at FROM cmp_tasktemplate";

fn read_template(row: &PgRow) -> sqlx::Result<TemplateRecord> {
    Ok(TemplateRecord {
        pid: row.try_get("pid")?,
        project_id: row.try_get("project_id")?,
        name: row.try_get("name")?,
        title: row.try_get("title")?,
        description: row.try_get("description")?,
        priority: row.try_get("priority")?,
        estimate_minutes: row.try_get("estimate_minutes")?,
        label_ids: row.try_get("label_ids")?,
        subtasks: row
            .try_get::<Vec<Option<String>>, _>("subtasks")?
            .into_iter()
            .map(|t| TemplateSubtask { title: t.unwrap_or_default() })
            .collect(),
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
    })
}

pub(crate) async fn load_template(store: &Store, pid: i64) -> anyhow::Result<Option<TemplateRecord>> {
    let row = sqlx::query(&format!("{SELECT_TEMPLATE} WHERE pid = $1"))
        .bind(pid)
        .fetch_optional(store.pool())
        .await?;
    Ok(match row {
        Some(r) => Some(read_template(&r)?),
        None => None,
    })
}

/// A project's templates, by name.
pub(crate) async fn templates_for(store: &Store, project_id: &str) -> anyhow::Result<Vec<TemplateRecord>> {
    let rows = sqlx::query(&format!(
        "{SELECT_TEMPLATE} WHERE project_id = $1 ORDER BY lower(name), pid"
    ))
    .bind(project_id)
    .fetch_all(store.pool())
    .await?;
    rows.iter().map(read_template).collect::<sqlx::Result<_>>().map_err(Into::into)
}

pub(crate) struct NewTemplate<'a> {
    pub project_id: &'a str,
    pub name: &'a str,
    pub title: &'a str,
    pub description: &'a str,
    pub priority: &'a str,
    pub estimate_minutes: Option<i32>,
    pub label_ids: Vec<String>,
    pub subtasks: Vec<TemplateSubtask>,
    pub created_by: &'a str,
    pub created_at: &'a str,
}

pub(crate) async fn create_template(store: &Store, t: NewTemplate<'_>) -> anyhow::Result<i64> {
    let mut tx = store.pool().begin().await?;
    let pid = entity::new_pid(&mut tx).await?;
    sqlx::query(
        "INSERT INTO cmp_tasktemplate (pid, project_id, name, title, description, priority, \
         estimate_minutes, label_ids, subtasks, created_by, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, to_jsonb($8::text[]), \
                 (SELECT COALESCE(jsonb_agg(jsonb_build_object('title', t) ORDER BY n), '[]'::jsonb) \
                  FROM unnest($9::text[]) WITH ORDINALITY AS u(t, n)), $10, $11)",
    )
    .bind(pid)
    .bind(t.project_id)
    .bind(t.name)
    .bind(t.title)
    .bind(t.description)
    .bind(t.priority)
    .bind(t.estimate_minutes)
    .bind(t.label_ids)
    .bind(t.subtasks.into_iter().map(|s| s.title).collect::<Vec<_>>())
    .bind(t.created_by)
    .bind(t.created_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(pid)
}

pub(crate) async fn delete_template(store: &Store, pid: i64) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    entity::delete(&mut tx, pid).await?;
    tx.commit().await?;
    Ok(())
}

/// Titles of `parent_id`'s subtasks, in their order.
pub(crate) async fn subtask_titles(conn: &Store, parent_id: &str) -> anyhow::Result<Vec<String>> {
    Ok(sqlx::query_scalar(
        "SELECT i.title FROM cmp_taskparent p JOIN cmp_taskinfo i ON i.pid = p.pid \
         WHERE p.parent_id = $1 ORDER BY i.sort_order, i.pid",
    )
    .bind(parent_id)
    .fetch_all(conn.pool())
    .await?)
}

/// THE definition of "template project" for every read about real work
/// (dashboard, reports, My tasks, workload, search, automations): their
/// tasks are blueprints, not work anyone is doing. Views of the template
/// itself, copying, exports and the activity log do not use this.
pub(crate) async fn template_project_ids(store: &Store) -> anyhow::Result<HashSet<String>> {
    Ok(sqlx::query_scalar::<_, String>("SELECT pid::text FROM cmp_projecttemplatemark")
        .fetch_all(store.pool())
        .await?
        .into_iter()
        .collect())
}

/// Remove `project_id`'s task templates, inside the caller's delete
/// transaction (they are keyed by a text project id, so no cascade reaches
/// them).
pub(crate) async fn delete_templates_for_project(conn: &mut PgConnection, project_id: &str) -> sqlx::Result<()> {
    sqlx::query(
        "DELETE FROM arke_entities WHERE pid IN \
         (SELECT pid FROM cmp_tasktemplate WHERE project_id = $1)",
    )
    .bind(project_id)
    .execute(conn)
    .await?;
    Ok(())
}
