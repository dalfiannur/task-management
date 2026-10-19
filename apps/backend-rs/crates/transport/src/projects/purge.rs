//! Removing a project for good: everything that belongs to it, in one
//! transaction. Rows are keyed by text `project_id` / `task_id`, so the
//! entity cascade never reaches them on its own; this lists every such
//! table. Media objects in storage are deleted after the commit.
//!
//! Also used for "leftovers": data whose project no longer exists at all,
//! from deletes made before projects went to the trash first.

use persistence::{entity, Store};

/// Every entity pid that belongs to `$1` (a project id as text), the
/// project's own entity aside.
const OWNED_PIDS: &str = "\
    WITH tasks AS ( \
        SELECT m.pid FROM cmp_taskmoduleref m \
        JOIN cmp_moduleprojectref mp ON mp.pid::text = m.module_id AND mp.project_id = $1 \
        UNION SELECT pid FROM cmp_tasknumber WHERE project_id = $1 \
    ), rules AS ( \
        SELECT pid FROM cmp_automation WHERE project_id = $1 \
    ) \
    SELECT pid FROM tasks \
    UNION SELECT pid FROM cmp_commentinfo WHERE task_id IN (SELECT pid::text FROM tasks) \
    UNION SELECT pid FROM cmp_timeentry WHERE project_id = $1 \
    UNION SELECT pid FROM rules \
    UNION SELECT pid FROM cmp_automationrun WHERE project_id = $1 \
    UNION SELECT pid FROM cmp_automationfired WHERE automation_id IN (SELECT pid::text FROM rules) \
    UNION SELECT pid FROM cmp_tasktemplate WHERE project_id = $1 \
    UNION SELECT pid FROM cmp_savedview WHERE project_id = $1 \
    UNION SELECT pid FROM cmp_taskstatusdef WHERE project_id = $1 \
    UNION SELECT pid FROM cmp_labelinfo WHERE project_id = $1 \
    UNION SELECT pid FROM cmp_pageinfo WHERE project_id = $1 \
    UNION SELECT pid FROM cmp_projectmembership WHERE project_id = $1 \
    UNION SELECT pid FROM cmp_moduleprojectref WHERE project_id = $1 \
    UNION SELECT pid FROM cmp_taskmedialinkdata WHERE project_id = $1 \
    UNION SELECT pid FROM cmp_mediafileinfo WHERE project_id = $1 \
    UNION SELECT pid FROM cmp_activityinfo WHERE project_id = $1 \
    UNION SELECT pid FROM cmp_notificationrefs WHERE project_id = $1";

/// Delete everything of `project_id` (and the project entity itself, when it
/// still exists). Returns the storage keys of its media files, for the caller
/// to delete once this has committed.
pub(crate) async fn purge_project(store: &Store, project_id: &str) -> anyhow::Result<Vec<String>> {
    let mut tx = store.pool().begin().await?;
    let keys: Vec<String> =
        sqlx::query_scalar("SELECT storage_key FROM cmp_mediafileinfo WHERE project_id = $1")
            .bind(project_id)
            .fetch_all(&mut *tx)
            .await?;
    sqlx::query(&format!("DELETE FROM arke_entities WHERE pid IN ({OWNED_PIDS})"))
        .bind(project_id)
        .execute(&mut *tx)
        .await?;
    if let Ok(pid) = project_id.parse::<i64>() {
        let is_project: bool =
            sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM cmp_projectname WHERE pid = $1)")
                .bind(pid)
                .fetch_one(&mut *tx)
                .await?;
        if is_project {
            entity::delete(&mut tx, pid).await?;
        }
    }
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
