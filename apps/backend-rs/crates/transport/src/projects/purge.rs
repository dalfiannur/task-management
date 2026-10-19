//! Removing a project for good: everything that belongs to it, in one
//! transaction. Rows are keyed by text `project_id` / `task_id`, so the
//! entity cascade never reaches them on its own; this lists every such
//! table. Media objects in storage are deleted after the commit.
//!
//! Also used for "leftovers": data whose project no longer exists at all,
//! from deletes made before projects went to the trash first.

use persistence::{entity, Store};
use sqlx::PgConnection;

use super::audit::{record_audit, NewAudit};

/// The tasks of the projects in `$1` (a `text[]` of project ids): through
/// their modules, and by task number for any whose module is already gone.
/// Shared by the purge and its preview so they can never disagree.
const TASKS_OF: &str = "\
    SELECT m.pid FROM cmp_taskmoduleref m \
    JOIN cmp_moduleprojectref mp ON mp.pid::text = m.module_id AND mp.project_id = ANY($1) \
    UNION SELECT pid FROM cmp_tasknumber WHERE project_id = ANY($1)";

/// Every entity pid that belongs to the projects in `$1`, the projects' own
/// entities aside.
fn owned_pids() -> String {
    format!(
        "WITH tasks AS ({TASKS_OF}), \
         rules AS (SELECT pid FROM cmp_automation WHERE project_id = ANY($1)) \
         SELECT pid FROM tasks \
         UNION SELECT pid FROM cmp_commentinfo WHERE task_id IN (SELECT pid::text FROM tasks) \
         UNION SELECT pid FROM cmp_timeentry WHERE project_id = ANY($1) \
         UNION SELECT pid FROM rules \
         UNION SELECT pid FROM cmp_automationrun WHERE project_id = ANY($1) \
         UNION SELECT pid FROM cmp_automationfired WHERE automation_id IN (SELECT pid::text FROM rules) \
         UNION SELECT pid FROM cmp_tasktemplate WHERE project_id = ANY($1) \
         UNION SELECT pid FROM cmp_savedview WHERE project_id = ANY($1) \
         UNION SELECT pid FROM cmp_taskstatusdef WHERE project_id = ANY($1) \
         UNION SELECT pid FROM cmp_labelinfo WHERE project_id = ANY($1) \
         UNION SELECT pid FROM cmp_pageinfo WHERE project_id = ANY($1) \
         UNION SELECT pid FROM cmp_projectmembership WHERE project_id = ANY($1) \
         UNION SELECT pid FROM cmp_moduleprojectref WHERE project_id = ANY($1) \
         UNION SELECT pid FROM cmp_taskmedialinkdata WHERE project_id = ANY($1) \
         UNION SELECT pid FROM cmp_mediafileinfo WHERE project_id = ANY($1) \
         UNION SELECT pid FROM cmp_activityinfo WHERE project_id = ANY($1) \
         UNION SELECT pid FROM cmp_notificationrefs WHERE project_id = ANY($1)"
    )
}

/// What a purge would remove, in the units people recognise.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Contents {
    pub tasks: i64,
    pub modules: i64,
    pub pages: i64,
    pub media_files: i64,
    pub media_bytes: i64,
    pub time_minutes: i64,
    pub comments: i64,
    pub automations: i64,
}

/// The contents of the projects in `project_ids`, counted over the same rows
/// the purge removes.
pub(crate) async fn contents(store: &Store, project_ids: &[String]) -> anyhow::Result<Contents> {
    let mut conn = store.pool().acquire().await?;
    contents_in(&mut conn, project_ids).await
}

/// [`contents`] inside a transaction (the purge counts what it removes).
async fn contents_in(conn: &mut PgConnection, project_ids: &[String]) -> anyhow::Result<Contents> {
    if project_ids.is_empty() {
        return Ok(Contents::default());
    }
    let row: (i64, i64, i64, i64, i64, i64, i64, i64) = sqlx::query_as(&format!(
        "WITH tasks AS ({TASKS_OF}) SELECT \
            (SELECT count(*) FROM tasks), \
            (SELECT count(*) FROM cmp_moduleprojectref WHERE project_id = ANY($1)), \
            (SELECT count(*) FROM cmp_pageinfo WHERE project_id = ANY($1)), \
            (SELECT count(*) FROM cmp_mediafileinfo WHERE project_id = ANY($1)), \
            (SELECT COALESCE(SUM(size), 0)::int8 FROM cmp_mediafileinfo WHERE project_id = ANY($1)), \
            (SELECT COALESCE(SUM(minutes), 0)::int8 FROM cmp_timeentry WHERE project_id = ANY($1)), \
            (SELECT count(*) FROM cmp_commentinfo WHERE task_id IN (SELECT pid::text FROM tasks)), \
            (SELECT count(*) FROM cmp_automation WHERE project_id = ANY($1))"
    ))
    .bind(project_ids)
    .fetch_one(conn)
    .await?;
    Ok(Contents {
        tasks: row.0,
        modules: row.1,
        pages: row.2,
        media_files: row.3,
        media_bytes: row.4,
        time_minutes: row.5,
        comments: row.6,
        automations: row.7,
    })
}

/// Who purges, and what the audit entry names (RFC-0004).
pub(crate) struct PurgeAudit<'a> {
    pub actor_id: &'a str,
    /// `audit::PROJECT_PURGED` or `audit::LEFTOVERS_PURGED`.
    pub action: &'a str,
    pub subject_id: &'a str,
    pub subject_name: &'a str,
    pub now: &'a str,
}

/// Delete everything of `project_ids` (and the project entities themselves,
/// when they still exist) and record one audit entry with what was removed,
/// all in one transaction. Returns the storage keys of their media files,
/// for the caller to delete once this has committed.
pub(crate) async fn purge_projects(
    store: &Store,
    project_ids: &[String],
    audit: PurgeAudit<'_>,
) -> anyhow::Result<Vec<String>> {
    let mut tx = store.pool().begin().await?;
    let removed = contents_in(&mut tx, project_ids).await?;
    let keys: Vec<String> =
        sqlx::query_scalar("SELECT storage_key FROM cmp_mediafileinfo WHERE project_id = ANY($1)")
            .bind(project_ids)
            .fetch_all(&mut *tx)
            .await?;
    sqlx::query(&format!("DELETE FROM arke_entities WHERE pid IN ({})", owned_pids()))
        .bind(project_ids)
        .execute(&mut *tx)
        .await?;
    let pids: Vec<i64> = project_ids.iter().filter_map(|id| id.parse().ok()).collect();
    let projects: Vec<i64> =
        sqlx::query_scalar("SELECT pid FROM cmp_projectname WHERE pid = ANY($1)")
            .bind(&pids)
            .fetch_all(&mut *tx)
            .await?;
    for pid in projects {
        entity::delete(&mut tx, pid).await?;
    }
    record_audit(
        &mut tx,
        NewAudit {
            actor_id: audit.actor_id,
            action: audit.action,
            subject_id: audit.subject_id,
            subject_name: audit.subject_name,
            contents: &removed,
            projects: project_ids.len() as i64,
            now: audit.now,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(keys)
}

/// Project ids that rows still point at although the project itself is gone.
pub(crate) async fn leftover_project_ids(store: &Store) -> anyhow::Result<Vec<String>> {
    Ok(sqlx::query_scalar(
        "SELECT DISTINCT x.project_id FROM ( \
             SELECT project_id FROM cmp_moduleprojectref \
             UNION SELECT project_id FROM cmp_projectmembership \
             UNION SELECT project_id FROM cmp_labelinfo \
             UNION SELECT project_id FROM cmp_taskstatusdef \
             UNION SELECT project_id FROM cmp_pageinfo \
             UNION SELECT project_id FROM cmp_mediafileinfo \
             UNION SELECT project_id FROM cmp_activityinfo \
             UNION SELECT project_id FROM cmp_timeentry \
             UNION SELECT project_id FROM cmp_savedview \
             UNION SELECT project_id FROM cmp_automation \
             UNION SELECT project_id FROM cmp_tasktemplate \
             UNION SELECT project_id FROM cmp_tasknumber \
         ) x \
         WHERE NOT EXISTS (SELECT 1 FROM cmp_projectname p WHERE p.pid::text = x.project_id) \
         ORDER BY 1",
    )
    .fetch_all(store.pool())
    .await?)
}
