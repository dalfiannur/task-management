//! The workspace audit log (RFC-0004): who trashed, restored or purged which
//! project, when, and what a purge removed. Not keyed to a project, so it
//! outlives every purge. Written inside the action's own transaction; read by
//! admins only; never updated or deleted.

use persistence::{entity, Store};
use sqlx::{PgConnection, Row};

use super::purge::Contents;

pub(crate) const PROJECT_TRASHED: &str = "project_trashed";
pub(crate) const PROJECT_RESTORED: &str = "project_restored";
pub(crate) const PROJECT_PURGED: &str = "project_purged";
pub(crate) const LEFTOVERS_PURGED: &str = "leftovers_purged";

pub(crate) struct NewAudit<'a> {
    pub actor_id: &'a str,
    pub action: &'a str,
    pub subject_id: &'a str,
    pub subject_name: &'a str,
    pub contents: &'a Contents,
    /// Leftover purges: how many projects' leftovers.
    pub projects: i64,
    pub now: &'a str,
}

pub(crate) async fn record_audit(conn: &mut PgConnection, a: NewAudit<'_>) -> sqlx::Result<()> {
    let pid = entity::new_pid(&mut *conn).await?;
    let c = a.contents;
    sqlx::query(
        "INSERT INTO cmp_auditentry (pid, actor_id, action, subject_id, subject_name, summary, created_at) \
         VALUES ($1, $2, $3, $4, $5, jsonb_build_object( \
             'tasks', $6::int8, 'modules', $7::int8, 'pages', $8::int8, 'media_files', $9::int8, \
             'media_bytes', $10::int8, 'time_minutes', $11::int8, 'comments', $12::int8, \
             'automations', $13::int8, 'projects', $14::int8), $15)",
    )
    .bind(pid)
    .bind(a.actor_id)
    .bind(a.action)
    .bind(a.subject_id)
    .bind(a.subject_name)
    .bind(c.tasks)
    .bind(c.modules)
    .bind(c.pages)
    .bind(c.media_files)
    .bind(c.media_bytes)
    .bind(c.time_minutes)
    .bind(c.comments)
    .bind(c.automations)
    .bind(a.projects)
    .bind(a.now)
    .execute(conn)
    .await?;
    Ok(())
}

#[derive(Debug, Clone)]
pub(crate) struct AuditRecord {
    pub pid: i64,
    pub actor_id: String,
    pub action: String,
    pub subject_id: String,
    pub subject_name: String,
    pub contents: Contents,
    pub projects: i64,
    pub created_at: String,
}

/// Newest first; `before` = continue below that pid (the page token).
pub(crate) async fn list_audit(store: &Store, limit: i64, before: Option<i64>) -> anyhow::Result<Vec<AuditRecord>> {
    let rows = sqlx::query(
        "SELECT pid, actor_id, action, subject_id, subject_name, created_at, \
                COALESCE((summary->>'tasks')::int8, 0) AS tasks, \
                COALESCE((summary->>'modules')::int8, 0) AS modules, \
                COALESCE((summary->>'pages')::int8, 0) AS pages, \
                COALESCE((summary->>'media_files')::int8, 0) AS media_files, \
                COALESCE((summary->>'media_bytes')::int8, 0) AS media_bytes, \
                COALESCE((summary->>'time_minutes')::int8, 0) AS time_minutes, \
                COALESCE((summary->>'comments')::int8, 0) AS comments, \
                COALESCE((summary->>'automations')::int8, 0) AS automations, \
                COALESCE((summary->>'projects')::int8, 0) AS projects \
         FROM cmp_auditentry WHERE ($1::int8 IS NULL OR pid < $1) \
         ORDER BY pid DESC LIMIT $2",
    )
    .bind(before)
    .bind(limit)
    .fetch_all(store.pool())
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(AuditRecord {
            pid: r.try_get("pid")?,
            actor_id: r.try_get("actor_id")?,
            action: r.try_get("action")?,
            subject_id: r.try_get("subject_id")?,
            subject_name: r.try_get("subject_name")?,
            contents: Contents {
                tasks: r.try_get("tasks")?,
                modules: r.try_get("modules")?,
                pages: r.try_get("pages")?,
                media_files: r.try_get("media_files")?,
                media_bytes: r.try_get("media_bytes")?,
                time_minutes: r.try_get("time_minutes")?,
                comments: r.try_get("comments")?,
                automations: r.try_get("automations")?,
            },
            projects: r.try_get("projects")?,
            created_at: r.try_get("created_at")?,
        });
    }
    Ok(out)
}
